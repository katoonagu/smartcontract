import { describe, expect, it, vi } from "vitest";
import * as createBotModule from "../../src/bot/createBot";
import type { AppConfig } from "../../src/config";
import { createBot, extractDeepForensicReportFromJob, extractSmartContractCheckReportFromJob, extractWhereIsMoneyReportFromJob, formatDeepForensicContextReadyReport, formatDeepForensicFailureUserDeliveryReport, formatDeepForensicReport, formatDeepForensicUserDeliveryReport, formatDeepForensicSupportReport, formatSmartContractCheckReport, formatWhereIsMoneyReport, formatWhereIsMoneySupportReport, formatWhereIsMoneyUserDeliveryReport } from "../../src/bot/createBot";
import { parseCallbackData } from "../../src/bot/keyboards";
import { tronscanApprovalsUrl } from "../../src/alerts/keyboards";
import { normalizeNotificationReason } from "../../src/alerts/notificationText";
import type { DeepAddressForensicReport } from "../../src/check/deepForensicCheck";
import type { ManualCheckResult } from "../../src/check/manualCheck";
import type { SmartContractCheckReport } from "../../src/check/smartContractCheck";
import type { CoverageDebugReport } from "../../src/forensics/coverageDebugReport";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser";
import { SCORING_SIGNAL_MATRIX_POLICY_VERSION } from "../../src/risk/scoringSignalMatrix";
import type { Db } from "../../src/storage/db";
import type { AddressPoisoningCandidate, AssetContinuationProfile, BotLocale, BoundaryExposureProfile, ContractDecisionEvidenceV1, ContractDecisionV2, CrossChainCorridorReport, CrossChainTerminalBoundary, FastCounterpartyTopsProfile, MoneyOriginSourceProvenanceMaterialitySummary, OperationalFlowProfile, RiskLabel, RiskReport, StablecoinRestrictionProfile, WalletAlertMode, WalletRoleProfile, WhereIsMoneyAssessment, WhereIsMoneyReport } from "../../src/types";
import type { AddressFastCheckJobInput, CustomerAlertRecipient, ForensicCheckJob, TelegramUserPendingAction, WalletDashboardSnapshot } from "../../src/storage/repositories";
import type { TronDashboardClient } from "../../src/tron/tronClient";
import { remediationTelegramUxCase } from "../fixtures/telegram/remediationTelegramUxCases";
import {
  TGYT_DIRECT_BLACKLIST_CASE,
  tgytBridgePath,
  tgytBridgePolicyEvidence,
  tgytDirectInteractionProfiles,
  tgytFirstHopBlacklistFact,
  tgytFirstHopCoverage,
  tgytSubjectRestriction
} from "../fixtures/forensics/directBlacklistCases";
import {
  POISON_RAW_REASON,
  bridgeWhereReportFixture,
  sourceWhereReportFixture,
  whereAssessmentFixture,
  whereReportFixture,
  whereRiskLayerFixture
} from "../fixtures/forensics/wherePreliminaryNarrativeCases";

const walletAddress = "TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD";
const secondWalletAddress = `T${"2".repeat(33)}`;
const txHash = "a".repeat(64);
const adminId = "9001";
const userId = "42";
const poisoningCallbackToken = "poisoningToken_1234";
const runtimeGitSha = "c".repeat(40);
const runtimeInstanceLabel = `unified-${runtimeGitSha.slice(0, 8)}`;

type RuntimeVersionFixture = {
  version: "runtime-version-v1";
  gitCommitSha: string;
  runtimeInstanceLabel: string;
  scoringPolicyVersion: "scoring-signal-matrix-v3";
  resultSchemaVersion: "score-anchor-v2+forensic-coverage-v2";
  narrativeVersion: "telegram-forensic-result-v1";
  migration: {
    verified: true;
    version: 32;
    filename: "032_telegram_runtime_forensics_data_contracts.sql";
    checksumSha256: string;
    shortChecksum: string;
  };
};

function runtimeVersionFixture(): RuntimeVersionFixture {
  const checksumSha256 = "41217f64c33cb416b9f5963e15ae56e074a6a527c1c2effdadff0d8b91f6938d";
  return Object.freeze({
    version: "runtime-version-v1",
    gitCommitSha: runtimeGitSha,
    runtimeInstanceLabel,
    scoringPolicyVersion: "scoring-signal-matrix-v3",
    resultSchemaVersion: "score-anchor-v2+forensic-coverage-v2",
    narrativeVersion: "telegram-forensic-result-v1",
    migration: Object.freeze({
      verified: true,
      version: 32,
      filename: "032_telegram_runtime_forensics_data_contracts.sql",
      checksumSha256,
      shortChecksum: checksumSha256.slice(0, 12)
    })
  });
}

function poisoningCandidate(overrides: Partial<AddressPoisoningCandidate> = {}): AddressPoisoningCandidate {
  return {
    id: "poisoning-candidate-1",
    callbackToken: poisoningCallbackToken,
    watchedWalletId: "wallet-1",
    tokenContract: TRON_USDT_CONTRACT_ADDRESS,
    tokenSymbol: "USDT",
    tokenDecimals: 6,
    suspiciousIncomingTxHash: "b".repeat(64),
    suspiciousSender: `T${"3".repeat(33)}`,
    suspiciousAmountRaw: "10000000",
    suspiciousIncomingAt: new Date("2026-07-12T12:00:45.000Z"),
    matchedOutgoingTxHash: "c".repeat(64),
    genuineRecipient: `T${"4".repeat(33)}`,
    matchedOutgoingAmountRaw: "10000000",
    matchedOutgoingAt: new Date("2026-07-12T12:00:00.000Z"),
    rawPrefixLength: 3,
    meaningfulPrefixLength: 2,
    suffixLength: 8,
    classification: "CRITICAL",
    confidence: "high",
    rawEvidenceId: "poisoning-evidence-1",
    secondaryMatches: [],
    evidenceJson: {},
    status: "candidate",
    alertFingerprint: "poisoning-fingerprint-1",
    alertStatus: "sent",
    alertLocale: "en",
    alertAttempts: 1,
    alertLeaseUpdatedAt: null,
    alertNextRetryAt: null,
    alertLastError: null,
    telegramChatId: userId,
    telegramMessageId: "10",
    laterLossTxHash: null,
    laterLossEvidenceJson: null,
    createdAt: new Date("2026-07-12T12:01:00.000Z"),
    updatedAt: new Date("2026-07-12T12:01:00.000Z"),
    resolvedAt: null,
    alertSentAt: new Date("2026-07-12T12:01:00.000Z"),
    ...overrides
  };
}

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
    unifiedProviderConcurrencyLimit: 100,
    unifiedProviderIncreaseStep: 1,
    unifiedProviderIncreaseIntervalMs: 1_000,
    unifiedProviderWorkerLimit: 100,
    unifiedAnalysisConcurrencyLimit: 2,
    unifiedFinalizationConcurrencyLimit: 2,
    unifiedLookaheadFactor: 2,
    unifiedPerRunLookaheadMaximum: 100,
    unifiedReadyBufferMaxEntries: 100,
    unifiedReadyBufferMaxBytes: 67_108_864,
    unifiedReservedBufferMaxBytes: 67_108_864,
    unifiedManifestHardLimitBytes: 16_777_216,
    unifiedChunkMaxPages: 2,
    unifiedChunkMaxWallMs: 30_000,
    unifiedChunkMaxResponseBytes: 8_388_608,
    unifiedChunkMaxCheckpointBytes: 1_048_576,
    unifiedRepairShare: 0.1,
    unifiedRepairMaxSlots: 4,
    unifiedRepairMaxWaitChunks: 8,
    unifiedReconciliationIntervalMs: 30_000,
    unifiedRollingRolloutStage: "global_barrier",
    unifiedTraversalPolicyVersion: "snapshot-closure-v1",
    unifiedRollingUserCheckBasisPoints: 0,
    unifiedProviderCapacityCeiling: 1,
    unifiedIsolatedWorkerOnly: false,
    tronscanDashboardCacheTtlMs: 300_000,
    tronscanDashboardMaxPages: 5,
    tronscanDashboardForceRefreshCooldownMs: 60_000,
    forensicWherePollIntervalMs: 2_000,
    forensicWhereWorkerConcurrency: 1,
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
    addressPoisoningSmallTransferMaxUsdt: "100",
    forensicWhereStartDelayMs: 3_000,
    forensicIncomingStartDelayMs: 6_000,
    forensicDeepStartDelayMs: 12_000,
    serviceAdminTelegramIds: new Set([adminId]),
    adminDashboardEnabled: false,
    adminDashboardHost: "127.0.0.1",
    adminDashboardPort: 8787,
    adminDashboardToken: null,
    runtimeGitSha: undefined,
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

      if (sql.includes("from forensic_check_jobs") && sql.includes("kind = 'address_deep_check'")) {
        return { rows: [], rowCount: 0 };
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

function messageUpdate(text: string, fromId: string | number, languageCode?: string) {
  return {
    update_id: Math.floor(Math.random() * 1_000_000),
    message: {
      message_id: 1,
      date: 1_778_880_000,
      chat: { id: Number(fromId), type: "private" as const, first_name: "Tester", username: `user_${fromId}` },
      from: {
        id: Number(fromId),
        is_bot: false,
        first_name: "Tester",
        username: `user_${fromId}`,
        ...(languageCode ? { language_code: languageCode } : {})
      },
      text,
      entities: text.startsWith("/")
        ? [{ type: "bot_command" as const, offset: 0, length: text.split(/\s+/, 1)[0].length }]
        : undefined
    }
  };
}

function routedMessageUpdate(text: string, fromId: string | number) {
  const update = messageUpdate(text, fromId);
  return {
    ...update,
    message: {
      ...update.message,
      is_topic_message: true,
      message_thread_id: 701,
      direct_messages_topic: { topic_id: 702 },
      business_connection_id: "business-703"
    }
  } as any;
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
  const value: ForensicCheckJob = {
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
  const whereReport = value.resultJson.whereIsMoneyReport;
  if (
    typeof whereReport === "object" &&
    whereReport !== null &&
    !Array.isArray(whereReport) &&
    (whereReport as Record<string, unknown>).scoringPolicyVersion === SCORING_SIGNAL_MATRIX_POLICY_VERSION &&
    value.resultJson.scoringPolicyVersion === undefined
  ) {
    value.resultJson = { ...value.resultJson, scoringPolicyVersion: SCORING_SIGNAL_MATRIX_POLICY_VERSION };
  }
  return value;
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
    scoreValid: true,
    scoreBlockedReason: null,
    technicalStatus: "completed",
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
    scoringPolicyVersion: SCORING_SIGNAL_MATRIX_POLICY_VERSION,
    scoreValid: true,
    scoreBlockedReason: null,
    technicalStatus: "completed",
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
      fetchedAddressCount: 3,
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
  const whereReport = whereIsMoneyReportForTest(overrides);
  return formatUnifiedAddressFinalReportForTest({
    address: whereReport.subjectAddress,
    whereReport,
    deepReport: freshNarrativeDeepReportForTest(),
    locale: "en"
  });
}

function formatCurrentWhereReportForTest(
  whereReport: WhereIsMoneyReport,
  locale: BotLocale = "en",
  showBetaDiagnostics = false
): string {
  return formatUnifiedAddressFinalReportForTest({
    address: whereReport.subjectAddress,
    whereReport,
    deepReport: freshNarrativeDeepReportForTest(),
    locale,
    showBetaDiagnostics
  });
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
    scoringPolicyVersion: SCORING_SIGNAL_MATRIX_POLICY_VERSION,
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
    firstHopBlacklistFacts: [],
    firstHopLabelFacts: [],
    firstHopBlacklistCoverage: {
      requiredForDecision: true,
      scope: "all_time",
      windowStart: null,
      windowEnd: null,
      directPrincipalTransferCoverage: "complete",
      materialCounterpartyCount: 0,
      checkedMaterialCounterpartyCount: 0,
      failedMaterialCounterpartyCount: 0,
      uncheckedMaterialCounterpartyCount: 0,
      blacklistCheckCoverage: "complete",
      incompleteReason: null,
      confirmedAdverseFactCount: 0,
      completeTimelineFactCount: 0,
      partialTimelineFactCount: 0
    },
    coverage: {
      sourceTransferPages: 0,
      inboundSendersExpanded: 0,
      transferEdges: 0
    },
    coverageDebug: emptyCoverageDebug(),
    ...overrides
  };
}

function freshNarrativeDeepReportForTest(
  overrides: Partial<DeepAddressForensicReport> = {}
): DeepAddressForensicReport {
  return deepReportForTest(overrides);
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
    scoringPolicyVersion: report.scoringPolicyVersion,
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
    ...(report.firstHopBlacklistFacts
      ? { firstHopBlacklistFacts: report.firstHopBlacklistFacts }
      : {}),
    ...(report.firstHopLabelFacts
      ? { firstHopLabelFacts: report.firstHopLabelFacts }
      : {}),
    ...(report.firstHopBlacklistCoverage
      ? { firstHopBlacklistCoverage: report.firstHopBlacklistCoverage }
      : {}),
    ...(report.directHardEvidenceSnapshots
      ? { directHardEvidenceSnapshots: report.directHardEvidenceSnapshots }
      : {}),
    missingChecks: report.missingChecks,
    coverage: report.coverage,
    coverageDebug: report.coverageDebug
  };
}

function persistedFirstHopEvidenceForTest() {
  const counterpartyAddress = `T${"9".repeat(33)}`;
  const timelineEvent = {
    eventKind: "added" as const,
    occurredAt: "2026-05-10T00:00:00.000Z",
    txHash: "b".repeat(64),
    tokenContract: TRON_USDT_CONTRACT_ADDRESS,
    blockNumber: 100,
    logIndex: 2,
    verification: "verified_contract_log" as const
  };
  const firstHopBlacklistFacts = [{
    counterpartyAddress,
    direction: "inbound" as const,
    evidenceKind: "usdt_blacklist" as const,
    evidenceAuthority: "official_contract" as const,
    statusAtCheck: "active" as const,
    temporalRelation: "active_at_transfer" as const,
    effectiveAt: timelineEvent.occurredAt,
    effectiveTxHash: timelineEvent.txHash,
    checkedAt: "2026-05-24T00:00:00.000Z",
    principalAmountRaw: "10000000000",
    principalTxCount: 1,
    directionalPrincipalShare: 0.75,
    shareSemantics: "exact" as const,
    transferTxHashes: ["a".repeat(64)],
    beforeEffectiveAmountRaw: "0",
    beforeEffectiveTxCount: 0,
    activeAmountRaw: "10000000000",
    activeTxCount: 1,
    unknownTimingAmountRaw: "0",
    unknownTimingTxCount: 0,
    directTransferCoverage: "complete" as const,
    timelineCoverage: "complete" as const,
    timelineEvents: [timelineEvent]
  }];
  const firstHopLabelFacts = [{
    counterpartyAddress,
    direction: "inbound" as const,
    labelCode: "phishing" as const,
    evidenceAuthority: "exact_internal" as const,
    recordedAt: "2026-05-01T00:00:00.000Z",
    effectiveAt: null,
    principalAmountRaw: "10000000000",
    principalTxCount: 1,
    directionalPrincipalShare: 0.75,
    shareSemantics: "exact" as const,
    transferTxHashes: ["a".repeat(64)],
    linkedToSelectedProvenance: false
  }];
  const firstHopBlacklistCoverage = {
    requiredForDecision: true,
    scope: "all_time" as const,
    windowStart: null,
    windowEnd: null,
    directPrincipalTransferCoverage: "complete" as const,
    materialCounterpartyCount: 1,
    checkedMaterialCounterpartyCount: 1,
    failedMaterialCounterpartyCount: 0,
    uncheckedMaterialCounterpartyCount: 0,
    blacklistCheckCoverage: "complete" as const,
    incompleteReason: null,
    confirmedAdverseFactCount: 1,
    completeTimelineFactCount: 1,
    partialTimelineFactCount: 0
  };
  const directHardEvidenceSnapshots = [{
    address: counterpartyAddress,
    labels: [{
      address: counterpartyAddress,
      label: "phishing",
      source: "service_admin",
      createdByTelegramId: "1",
      createdAt: "2026-05-01T00:00:00.000Z"
    }],
    classification: null,
    usdtRestriction: {
      subjectAddress: counterpartyAddress,
      tokenContract: TRON_USDT_CONTRACT_ADDRESS,
      tokenSymbol: "USDT",
      tokenStandard: "TRC20",
      decimals: 6,
      isBlacklisted: true,
      balanceRaw: "0",
      checkedAt: "2026-05-24T00:00:00.000Z",
      evidenceStrength: "exact_contract_state",
      blacklistEventTxHash: timelineEvent.txHash,
      blacklistEventTimestamp: timelineEvent.occurredAt,
      blacklistEventBlock: 100,
      blacklistTimeline: { events: [timelineEvent], pagination: "complete", failureReason: null },
      methods: { blacklist: "isBlackListed(address)", balance: "balanceOf(address)" }
    },
    evidenceStatus: "live_checked",
    hasHardEvidence: true,
    reasons: ["label:phishing", "usdt_blacklist"]
  }];
  return {
    firstHopBlacklistFacts,
    firstHopLabelFacts,
    firstHopBlacklistCoverage,
    directHardEvidenceSnapshots
  };
}

function formatUnifiedAddressFinalReportForTest(input: {
  address: string;
  whereReport: WhereIsMoneyReport;
  fastReport?: RiskReport | null;
  deepReport?: DeepAddressForensicReport | null;
  smartContractReport?: SmartContractCheckReport | null;
  locale?: BotLocale;
  showBetaDiagnostics?: boolean;
}): string {
  const formatter = (createBotModule as {
    formatUnifiedAddressFinalReport?: (input: {
      address: string;
      whereReport: WhereIsMoneyReport;
      fastReport?: RiskReport | null;
      deepReport?: DeepAddressForensicReport | null;
      smartContractReport?: SmartContractCheckReport | null;
      locale?: BotLocale;
      showBetaDiagnostics?: boolean;
    }) => { text: string };
  }).formatUnifiedAddressFinalReport;

  expect(formatter, "formatUnifiedAddressFinalReport should be exported by the unified final-report formatter").toBeTypeOf("function");
  return plainTelegramText(formatter!({
    ...input,
    deepReport: input.deepReport === undefined ? freshNarrativeDeepReportForTest() : input.deepReport
  }).text);
}

function expectCompactScoredNarrative(text: string, score: number): void {
  expect(text).toMatch(new RegExp(`^[🟢🟡🟠🔴] ${score}/100 —`, "u"));
  expect(text).not.toContain("Address check — final");
  expect(text).not.toContain("Проверка адреса — итог");
  expect(text).not.toContain("Where-is-money — support/debug");
}

function expectCompactNoFinalNarrative(text: string): void {
  expect(text).toMatch(/⚪ (?:No final result|Final score was not calculated|Итог(?:овая оценка)? не рассчитан)/u);
  expect(text).not.toMatch(/\d+\/100/u);
  expect(text).not.toContain("Address check - no final decision");
  expect(text).not.toContain("Проверка адреса — без итогового решения");
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
      publicTag: null,
      publicTagDesc: null,
      providerTags: [],
      publicTags: [],
      isVerified: true,
      verified: true,
      providerRisk: false,
      activityLevel: "normal",
      hasTransferFromSelector: true,
      methodMap: {},
      topMethods: []
    } as unknown as SmartContractCheckReport["contractProfile"],
    relatedApprovals: [],
    llmVerdict: null,
    exactDrainProven: false,
    verify20Fingerprint: {
      matched: false,
      selectors: [],
      blockedByTrustedService: true,
      missingSelectors: ["5082dd12", "fc61dd23", "ea4418d9", "f2fde38b"],
      mismatchedSelectors: []
    },
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

function exactVerify20ContractReportForTest(): SmartContractCheckReport {
  const base = smartContractReportForTest();
  return smartContractReportForTest({
    decision: "DECLINE",
    decisionScope: "contract_safety",
    riskScore: 85,
    riskLevel: "CRITICAL",
    serviceLabel: null,
    activityLabel: "low",
    metadata: {
      ...base.metadata,
      name: null,
      tag: null,
      verified: false
    },
    contractProfile: {
      ...base.contractProfile!,
      name: null,
      serviceTag: null,
      isVerified: false,
      verified: false,
      activityLevel: "low",
      methodMap: {
        "5082dd12": "Verify20(address,address,address,uint256)",
        "fc61dd23": "Verify10(address,uint256)",
        "ea4418d9": "withdrawAllTrxTo(address)",
        "f2fde38b": "transferOwnership(address)"
      },
      topMethods: []
    },
    verify20Fingerprint: {
      matched: true,
      selectors: ["5082dd12", "fc61dd23", "ea4418d9", "f2fde38b"],
      blockedByTrustedService: false,
      missingSelectors: [],
      mismatchedSelectors: []
    },
    reasons: ["address_is_smart_contract", "exact_verify20_contract_pattern"]
  });
}

function freshContractDecisionReportForTest(input: {
  authority: ContractDecisionV2["deterministic"]["authority"];
  evidenceKind: ContractDecisionEvidenceV1["kind"];
  evidenceId?: string;
}): SmartContractCheckReport {
  const outcomes: Record<ContractDecisionV2["deterministic"]["authority"], {
    score: number;
    level: ContractDecisionV2["deterministic"]["level"];
    decision: ContractDecisionV2["deterministic"]["decision"];
  }> = {
    exact_debit: { score: 95, level: "CRITICAL", decision: "DECLINE" },
    provider_risk: { score: 90, level: "CRITICAL", decision: "DECLINE" },
    verify20_fingerprint: { score: 90, level: "CRITICAL", decision: "DECLINE" },
    official_registry: { score: 10, level: "LOW", decision: "ACCEPTABLE" },
    gasfree_account: { score: 10, level: "LOW", decision: "ACCEPTABLE" },
    known_service_session: { score: 10, level: "LOW", decision: "ACCEPTABLE" },
    context: { score: 35, level: "MEDIUM", decision: "REVIEW" }
  };
  const outcome = outcomes[input.authority];
  const evidenceId = input.evidenceId ?? `evidence:${input.authority}`;
  const transactionBound = ["approval_event", "allowance_read", "exact_debit", "service_action"].includes(input.evidenceKind);
  return smartContractReportForTest({
    decision: outcome.decision,
    decisionScope: "contract_safety",
    riskScore: outcome.score,
    riskLevel: outcome.level,
    reasons: [`contract_decision_${input.authority}`],
    contractDecisionV2: {
      deterministic: { ...outcome, authority: input.authority, evidenceIds: [evidenceId] },
      finalSource: "deterministic",
      llm: null
    },
    contractDecisionEvidenceV1: [{
      id: evidenceId,
      kind: input.evidenceKind,
      subjectAddress: walletAddress,
      spenderAddress: transactionBound ? walletAddress : null,
      tokenContract: transactionBound ? TRON_USDT_CONTRACT_ADDRESS : null
    }]
  });
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

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function grammyErrorWithSecret(errorCode: number, secret: string): Record<string, unknown> {
  return {
    name: "GrammyError",
    message: `Telegram request failed: ${secret}`,
    method: "sendMessage",
    payload: {
      chat_id: `chat-${secret}`,
      text: secret,
      reply_markup: { token: secret }
    },
    error: {
      error_code: errorCode,
      description: `Bad Request: ${secret}`,
      parameters: { secret }
    }
  };
}

async function settlesThisTurn(promises: Promise<unknown>[]): Promise<boolean> {
  return Promise.race([
    Promise.all(promises).then(() => true),
    new Promise<false>((resolve) => setImmediate(() => resolve(false)))
  ]);
}

function createQueuedForensicJobCaptureDb(defaultLocale: BotLocale = "en"): {
  db: Db;
  progressByKind: Map<ForensicCheckJob["kind"], Record<string, unknown>>;
} {
  const baseDb = createFakeDb(defaultLocale);
  const progressByKind = new Map<ForensicCheckJob["kind"], Record<string, unknown>>();
  const db = {
    async connect() {
      return baseDb.connect();
    },
    async query(sql: string, params: unknown[] = []) {
      if (sql.includes("insert into forensic_check_jobs") && sql.includes("'queued'")) {
        const kind = String(params[1]) as ForensicCheckJob["kind"];
        const progressJson = params[9] as Record<string, unknown>;
        progressByKind.set(kind, progressJson);
        const now = new Date("2026-05-24T00:00:00.000Z");
        return {
          rows: [{
            id: params[0],
            kind,
            subject_address: params[2],
            status: "queued",
            window_start: params[3],
            window_end: params[4],
            priority: params[5],
            chat_id: params[6],
            message_id: params[7],
            requested_by: params[8],
            progress_json: progressJson,
            result_json: {},
            raw_evidence_ids: [],
            observation_ids: [],
            last_error: null,
            created_at: now,
            updated_at: now,
            started_at: null,
            completed_at: null
          }],
          rowCount: 1
        };
      }
      return baseDb.query(sql, params);
    }
  } as unknown as Db;
  return { db, progressByKind };
}

async function createSmokeBot(options: {
  failAnswerCallbackQuery?: boolean;
  failEditMessageReplyMarkup?: boolean;
  addressRiskSignals?: (address: string) => Promise<any>;
  queueDeepForensicJob?: BotOptions["queueDeepForensicJob"];
  queueWhereIsMoneyJob?: BotOptions["queueWhereIsMoneyJob"];
  saveAddressFastCheckJob?: BotOptions["saveAddressFastCheckJob"];
  checkSmartContractAddress?: BotOptions["checkSmartContractAddress"];
  getForensicCheckJob?: BotOptions["getForensicCheckJob"];
  getLatestWhereIsMoneyCheckJobForAddress?: BotOptions["getLatestWhereIsMoneyCheckJobForAddress"];
  getLatestDeepForensicCheckJobForAddressAnyStatus?: BotOptions["getLatestDeepForensicCheckJobForAddressAnyStatus"];
  resolveAddressPoisoningCandidate?: (input: {
    callbackToken: string;
    telegramUserId: string;
    resolution: "confirmed" | "dismissed";
  }) => Promise<{
    outcome: "updated" | "idempotent" | "conflict" | "unavailable";
    candidate: AddressPoisoningCandidate | null;
  }>;
  tronClient?: TronDashboardClient;
  runtimeInstanceLabel?: string;
  runtimeVersion?: RuntimeVersionFixture;
  defaultLocale?: BotLocale;
  db?: Db;
  beforeApiResult?: (method: string, payload: Record<string, unknown>) => Promise<void>;
  runSafetyRecheck?: BotOptions["runSafetyRecheck"];
  createUnifiedCheckRequest?: BotOptions["createUnifiedCheckRequest"];
} = {}) {
  const config = {
    ...createConfig(),
    runtimeInstanceLabel: options.runtimeInstanceLabel
  };
  const botOptions = {
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
    getForensicCheckJob: options.getForensicCheckJob,
    getLatestWhereIsMoneyCheckJobForAddress: options.getLatestWhereIsMoneyCheckJobForAddress,
    getLatestDeepForensicCheckJobForAddressAnyStatus: options.getLatestDeepForensicCheckJobForAddressAnyStatus,
    resolveAddressPoisoningCandidate: options.resolveAddressPoisoningCandidate,
    runSafetyRecheck: options.runSafetyRecheck,
    createUnifiedCheckRequest: options.createUnifiedCheckRequest,
    runtimeVersion: options.runtimeVersion
  } as BotOptions & { runtimeVersion?: RuntimeVersionFixture };
  const bot = createBot(
    config,
    options.db ?? createFakeDb(options.defaultLocale ?? "en"),
    options.tronClient ?? createTronClient(),
    botOptions
  );
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
    if (method === "editMessageReplyMarkup" && options.failEditMessageReplyMarkup) {
      throw new Error("Call to 'editMessageReplyMarkup' failed");
    }
    await options.beforeApiResult?.(method, payload as Record<string, unknown>);
    return { ok: true, result: true };
  });
  await bot.init();
  return { bot, calls };
}

describe("bot command and inline UX smoke coverage", () => {
  it("[REQ-32][RUNTIME-VERSION] returns exact pure RU and EN output without DB or provider calls", async () => {
    const runtimeVersion = runtimeVersionFixture();
    const db = createFakeDb();
    const originalQuery = db.query.bind(db);
    let dbCalls = 0;
    (db as any).query = async (...args: unknown[]) => {
      dbCalls += 1;
      return originalQuery(...args as Parameters<typeof originalQuery>);
    };
    let providerCalls = 0;
    const tronClient = new Proxy(createTronClient(), {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          providerCalls += 1;
          return value.apply(target, args);
        };
      }
    });
    const { bot, calls } = await createSmokeBot({ db, tronClient, runtimeVersion });

    await bot.handleUpdate(messageUpdate("/version", userId, "en"));
    await bot.handleUpdate(messageUpdate("/version", userId, "ru"));

    expect(messageCalls(calls).map((call) => call.payload.text)).toEqual([
      [
        "Runtime version",
        `Git SHA: ${runtimeGitSha}`,
        `Instance: ${runtimeInstanceLabel}`,
        "Scoring policy: scoring-signal-matrix-v3",
        "Result schema: score-anchor-v2+forensic-coverage-v2",
        "Narrative: telegram-forensic-result-v1",
        "Database schema: schema 032 verified · 41217f64c33c"
      ].join("\n"),
      [
        "Версия runtime",
        `Git SHA: ${runtimeGitSha}`,
        `Инстанс: ${runtimeInstanceLabel}`,
        "Политика скоринга: scoring-signal-matrix-v3",
        "Схема результата: score-anchor-v2+forensic-coverage-v2",
        "Версия объяснения: telegram-forensic-result-v1",
        "Схема БД: schema 032 verified · 41217f64c33c"
      ].join("\n")
    ]);
    expect(dbCalls).toBe(0);
    expect(providerCalls).toBe(0);
    expect(Object.isFrozen(runtimeVersion)).toBe(true);
    expect(Object.isFrozen(runtimeVersion.migration)).toBe(true);
  });

  it("[REQ-18][AC-20][TASK7-RECHECK-AUDIENCE] renders manual safety recheck as an external-address check", async () => {
    const fixture = remediationTelegramUxCase("GOLDEN_VERIFY20_ACTIVE_NO_DEBIT");
    const approvalInput = fixture.source.approvalInput;
    if (!approvalInput) throw new Error("missing approval fixture");
    const { bot, calls } = await createSmokeBot({
      defaultLocale: "ru",
      runSafetyRecheck: async (input) => ({
        walletAddress: input.walletAddress,
        walletFound: true,
        target: input.target ?? { kind: "wallet" },
        approvalsProcessed: 1,
        approvalEventsClaimed: 0,
        riskRowsUpdated: 1,
        drainObservationsClaimed: 0,
        approvalPresentations: [{
          assessment: approvalInput.assessment,
          exactDebitProfile: approvalInput.exactDebitProfile,
          metadataContext: null,
          campaignContext: approvalInput.campaignContext ?? null,
          evaluatedAt: fixture.source.evaluatedAt
        }]
      })
    });

    await bot.handleUpdate(messageUpdate(`/recheck_safety ${fixture.source.checkedWalletAddress}`, adminId));

    const messages = messageCalls(calls).map((call) => String(call.payload.text ?? ""));
    expect(messages[0]).toContain("Проверяемый кошелёк — кошелёк, который выдал доступ к USDT");
    expect(messages[0]).toContain("Контракт, получивший доступ к USDT");
    expect(messages[0]).toContain("BTTOLD-последовательность");
    expect(messages[0]).toContain("Если вы проверяете чужой кошелёк");
    expect(messages[0]).not.toContain("На отслеживаемом кошельке");
    expect(messages.at(-1)).toContain("Safety recheck complete.");
  });

  it("strictly parses address-poisoning decisions", () => {
    expect(parseCallbackData(`poison:confirm:${poisoningCallbackToken}`)).toEqual({
      kind: "address_poisoning_confirm",
      callbackToken: poisoningCallbackToken
    });
    expect(parseCallbackData(`poison:dismiss:${poisoningCallbackToken}`)).toEqual({
      kind: "address_poisoning_dismiss",
      callbackToken: poisoningCallbackToken
    });

    for (const malformed of [
      `poison:confirm:${"a".repeat(15)}`,
      `poison:confirm:${"a".repeat(25)}`,
      "poison:confirm:invalid.token1234",
      `poison:confirm:${poisoningCallbackToken}:extra`,
      `poison:unknown:${poisoningCallbackToken}`,
      `Poison:confirm:${poisoningCallbackToken}`,
      `poison:Confirm:${poisoningCallbackToken}`,
      ` poison:confirm:${poisoningCallbackToken}`,
      `poison:confirm:${poisoningCallbackToken} `,
      `wrong:confirm:${poisoningCallbackToken}`
    ]) {
      expect(parseCallbackData(malformed), malformed).toBeNull();
    }
  });

  it.each([
    ["confirm", "confirmed", "Address marked as replacement."],
    ["dismiss", "dismissed", "Address marked as familiar."]
  ] as const)("lets the owner %s a poisoning candidate and removes only mutation buttons", async (action, resolution, successText) => {
    const resolverInputs: unknown[] = [];
    const candidate = poisoningCandidate({ status: resolution });
    const { bot, calls } = await createSmokeBot({
      resolveAddressPoisoningCandidate: async (input) => {
        resolverInputs.push(input);
        return { outcome: "updated", candidate };
      }
    });

    await bot.handleUpdate(callbackQueryUpdate(`poison:${action}:${poisoningCallbackToken}`, userId));

    expect(resolverInputs).toEqual([{
      callbackToken: poisoningCallbackToken,
      telegramUserId: userId,
      resolution
    }]);
    const answers = calls.filter((call) => call.method === "answerCallbackQuery");
    expect(answers).toHaveLength(1);
    expect(answers[0].payload.text).toBe(successText);
    const edits = calls.filter((call) => call.method === "editMessageReplyMarkup");
    expect(edits).toHaveLength(1);
    expect(edits[0].payload).not.toHaveProperty("text");
    const buttons = edits[0].payload.reply_markup.inline_keyboard.flat();
    expect(buttons).toHaveLength(2);
    expect(buttons.every((button: Record<string, unknown>) => typeof button.url === "string")).toBe(true);
    expect(buttons.every((button: Record<string, unknown>) => button.callback_data === undefined)).toBe(true);
  });

  it("treats an identical replay as successful and retries the terminal keyboard edit", async () => {
    let resolverCalls = 0;
    const { bot, calls } = await createSmokeBot({
      resolveAddressPoisoningCandidate: async () => {
        resolverCalls += 1;
        return { outcome: "idempotent", candidate: poisoningCandidate({ status: "confirmed" }) };
      }
    });

    await bot.handleUpdate(callbackQueryUpdate(`poison:confirm:${poisoningCallbackToken}`, userId));
    await bot.handleUpdate(callbackQueryUpdate(`poison:confirm:${poisoningCallbackToken}`, userId));

    expect(resolverCalls).toBe(2);
    expect(calls.filter((call) => call.method === "answerCallbackQuery").map((call) => call.payload.text)).toEqual([
      "Address marked as replacement.",
      "Address marked as replacement."
    ]);
    expect(calls.filter((call) => call.method === "editMessageReplyMarkup")).toHaveLength(2);
  });

  it.each(["unavailable", "conflict"] as const)("does not leak candidate facts for a %s outcome", async (outcome) => {
    const resolverInputs: unknown[] = [];
    const update = callbackQueryUpdate(`poison:confirm:${poisoningCallbackToken}`, "99");
    update.callback_query.message.chat.id = Number(userId);
    const { bot, calls } = await createSmokeBot({
      resolveAddressPoisoningCandidate: async (input) => {
        resolverInputs.push(input);
        return {
          outcome,
          candidate: null
        };
      }
    });

    await bot.handleUpdate(update);

    expect(resolverInputs).toEqual([{
      callbackToken: poisoningCallbackToken,
      telegramUserId: "99",
      resolution: "confirmed"
    }]);
    const answers = calls.filter((call) => call.method === "answerCallbackQuery");
    expect(answers).toHaveLength(1);
    expect(answers[0].payload.text).toBe("Action unavailable. A decision may already have been made.");
    expect(calls.some((call) => call.method === "editMessageReplyMarkup")).toBe(false);
  });

  it("uses the same neutral response for an unknown token and never edits the message", async () => {
    const resolverInputs: unknown[] = [];
    const unknownToken = "unknownToken_12345";
    const { bot, calls } = await createSmokeBot({
      resolveAddressPoisoningCandidate: async (input) => {
        resolverInputs.push(input);
        return { outcome: "unavailable", candidate: null };
      }
    });

    await bot.handleUpdate(callbackQueryUpdate(`poison:dismiss:${unknownToken}`, userId));

    expect(resolverInputs).toEqual([{
      callbackToken: unknownToken,
      telegramUserId: userId,
      resolution: "dismissed"
    }]);
    expect(calls.filter((call) => call.method === "answerCallbackQuery").map((call) => call.payload.text)).toEqual([
      "Action unavailable. A decision may already have been made."
    ]);
    expect(calls.some((call) => call.method === "editMessageReplyMarkup")).toBe(false);
  });

  it("fails closed when the callback has no sender or an updated outcome has no candidate", async () => {
    let resolverCalls = 0;
    const missingSender = callbackQueryUpdate(`poison:confirm:${poisoningCallbackToken}`, userId);
    delete (missingSender.callback_query as { from?: unknown }).from;
    const first = await createSmokeBot({
      defaultLocale: "ru",
      resolveAddressPoisoningCandidate: async () => {
        resolverCalls += 1;
        return { outcome: "updated", candidate: poisoningCandidate({ status: "confirmed" }) };
      }
    });
    await first.bot.handleUpdate(missingSender as never);
    expect(resolverCalls).toBe(0);
    expect(first.calls.filter((call) => call.method === "answerCallbackQuery").map((call) => call.payload.text)).toEqual([
      "Действие недоступно. Возможно, решение уже принято."
    ]);
    expect(first.calls.some((call) => call.method === "editMessageReplyMarkup")).toBe(false);

    const second = await createSmokeBot({
      resolveAddressPoisoningCandidate: async () => ({ outcome: "updated", candidate: null })
    });
    await second.bot.handleUpdate(callbackQueryUpdate(`poison:confirm:${poisoningCallbackToken}`, userId));
    expect(second.calls.filter((call) => call.method === "answerCallbackQuery").map((call) => call.payload.text)).toEqual([
      "Action unavailable. A decision may already have been made."
    ]);
    expect(second.calls.some((call) => call.method === "editMessageReplyMarkup")).toBe(false);
  });

  it("localizes Russian poisoning decisions", async () => {
    const candidate = poisoningCandidate({ status: "dismissed", alertLocale: "ru" });
    const { bot, calls } = await createSmokeBot({
      defaultLocale: "ru",
      resolveAddressPoisoningCandidate: async () => ({ outcome: "updated", candidate })
    });

    await bot.handleUpdate(callbackQueryUpdate(`poison:dismiss:${poisoningCallbackToken}`, userId));

    expect(calls.filter((call) => call.method === "answerCallbackQuery").map((call) => call.payload.text)).toEqual([
      "Адрес отмечен как знакомый."
    ]);
    const edit = calls.find((call) => call.method === "editMessageReplyMarkup");
    expect(edit?.payload.reply_markup.inline_keyboard[0].map((button: { text: string }) => button.text)).toEqual([
      "Входящий перевод",
      "Исходящий перевод"
    ]);
  });

  it("uses the locale fixed on the sent alert even after the owner changes their preference", async () => {
    const candidate = poisoningCandidate({ status: "confirmed", alertLocale: "ru" });
    const { bot, calls } = await createSmokeBot({
      defaultLocale: "en",
      resolveAddressPoisoningCandidate: async () => ({ outcome: "updated", candidate })
    });

    await bot.handleUpdate(callbackQueryUpdate(`poison:confirm:${poisoningCallbackToken}`, userId));

    expect(calls.filter((call) => call.method === "answerCallbackQuery").map((call) => call.payload.text)).toEqual([
      "Адрес помечен как подмена."
    ]);
    const edit = calls.find((call) => call.method === "editMessageReplyMarkup");
    expect(edit?.payload.reply_markup.inline_keyboard[0].map((button: { text: string }) => button.text)).toEqual([
      "Входящий перевод",
      "Исходящий перевод"
    ]);
  });

  it("fails closed when an authorized candidate has no fixed alert locale", async () => {
    const { bot, calls } = await createSmokeBot({
      defaultLocale: "en",
      resolveAddressPoisoningCandidate: async () => ({
        outcome: "idempotent",
        candidate: poisoningCandidate({ status: "confirmed", alertLocale: null })
      })
    });

    await bot.handleUpdate(callbackQueryUpdate(`poison:confirm:${poisoningCallbackToken}`, userId));

    expect(calls.filter((call) => call.method === "answerCallbackQuery").map((call) => call.payload.text)).toEqual([
      "Action unavailable. A decision may already have been made."
    ]);
    expect(calls.some((call) => call.method === "editMessageReplyMarkup")).toBe(false);
  });

  it("does not answer twice or reverse state when the terminal keyboard edit fails", async () => {
    let resolverCalls = 0;
    const { bot, calls } = await createSmokeBot({
      failEditMessageReplyMarkup: true,
      resolveAddressPoisoningCandidate: async () => {
        resolverCalls += 1;
        return { outcome: "updated", candidate: poisoningCandidate({ status: "confirmed" }) };
      }
    });

    await expect(bot.handleUpdate(callbackQueryUpdate(`poison:confirm:${poisoningCallbackToken}`, userId))).resolves.toBeUndefined();

    expect(resolverCalls).toBe(1);
    expect(calls.filter((call) => call.method === "answerCallbackQuery")).toHaveLength(1);
    expect(calls.filter((call) => call.method === "editMessageReplyMarkup")).toHaveLength(1);
  });

  it("keeps existing callbacks unchanged and never resolves malformed poisoning data", async () => {
    let resolverCalls = 0;
    const { bot, calls } = await createSmokeBot({
      resolveAddressPoisoningCandidate: async () => {
        resolverCalls += 1;
        return { outcome: "unavailable", candidate: null };
      }
    });

    await bot.handleUpdate(callbackQueryUpdate("help", userId));
    expect(calls.filter((call) => call.method === "answerCallbackQuery")).toHaveLength(1);
    expect(lastText(calls)).toContain("TRON Guard help");

    await bot.handleUpdate(callbackQueryUpdate(`poison:confirm:${"x".repeat(15)}`, userId));
    expect(resolverCalls).toBe(0);
    expect(calls.filter((call) => call.method === "answerCallbackQuery")).toHaveLength(2);
  });

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

    const messages = messageCalls(calls);
    const dashboardCall = messages.find((call) => String(call.payload.text).includes("📍 Wallet dashboard"));
    expect(plainTelegramText(String(messages[0].payload.text))).toMatch(/loading wallet data/i);
    expect(dashboardCall).toBeDefined();
    const dashboardText = String(dashboardCall!.payload.text);
    const plainDashboard = plainTelegramText(dashboardText);
    expect(plainDashboard).toContain(walletAddress);
    expect(plainDashboard).toContain("Monitoring: active");
    expect(plainDashboard).toContain("Alerts: realtime");
    expect(plainDashboard).toContain("Wallet safety: 🟢 OK");
    expect(plainDashboard).toContain("Risk: 🟢 0/100 (LOW, beta)");
    expect(plainDashboard).toContain("USDT: 7.00");
    expect(plainDashboard).toContain("Gas/fees: 6.00 TRX");
    expect(dashboardText).not.toContain("tx total");
    expect(buttonTexts(dashboardCall!.payload)).toContain("🔄 Refresh");
    expect(buttonTexts(dashboardCall!.payload)).toContain("📊 Analytics");
    expect(buttonTexts(dashboardCall!.payload)).toContain("🛡 Safety");
    expect(buttonTexts(dashboardCall!.payload)).toContain("🔎 Address");
    expect(buttonTexts(dashboardCall!.payload)).toContain("🧾 Tx");
    expect(buttonTexts(dashboardCall!.payload).some((text) => text.includes("Alert mode"))).toBe(true);
    expect(lastPlainText(calls)).toContain("Watched wallets: 1");
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

  it("routes a fenced wallet check to Unified without preliminary or child messages", async () => {
    const requests: Array<Parameters<NonNullable<BotOptions["createUnifiedCheckRequest"]>>[0]> = [];
    let legacyProviderCalls = 0;
    const { bot, calls } = await createSmokeBot({
      defaultLocale: "ru",
      createUnifiedCheckRequest: async (input) => {
        requests.push(input);
        return true;
      },
      addressRiskSignals: async () => {
        legacyProviderCalls += 1;
        return { graphSignals: [], behaviorSignals: [], amlSignals: [] };
      },
      queueWhereIsMoneyJob: async () => {
        throw new Error("legacy_where_must_not_run");
      },
      queueDeepForensicJob: async () => {
        throw new Error("legacy_deep_must_not_run");
      }
    });
    const update = messageUpdate(`/check ${walletAddress}`, userId, "ru");

    await bot.handleUpdate(update);

    expect(requests).toEqual([expect.objectContaining({
      requestCorrelationId: `telegram:${update.update_id}:wallet-check`,
      subjectAddress: walletAddress,
      chatId: userId,
      messageThreadId: "",
      locale: "ru"
    })]);
    expect(legacyProviderCalls).toBe(0);
    expect(messageCalls(calls)).toEqual([]);
  });

  it("keeps transaction and incoming routes outside the Unified wallet fence", async () => {
    let unifiedRequests = 0;
    let incomingLookups = 0;
    const depositJobId = "42a0a912-dc6a-45b5-b281-a2f0c7ac034e";
    const { bot, calls } = await createSmokeBot({
      createUnifiedCheckRequest: async () => {
        unifiedRequests += 1;
        return true;
      },
      getForensicCheckJob: async (id) => {
        expect(id).toBe(depositJobId);
        incomingLookups += 1;
        return null;
      }
    });

    await bot.handleUpdate(messageUpdate(`/check ${txHash}`, userId, "ru"));
    await bot.handleUpdate(callbackQueryUpdate(
      `check:deposit:${depositJobId}`,
      userId
    ));

    expect(unifiedRequests).toBe(0);
    expect(incomingLookups).toBe(1);
    expect(messageCalls(calls).length).toBeGreaterThan(0);
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
    expect(savedFastJob.resultJson.scoringPolicyVersion).toBe(SCORING_SIGNAL_MATRIX_POLICY_VERSION);
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

  it("runs contract safety Fast Where and Deep for a contract address", async () => {
    const queued: string[] = [];
    const queuedAnalyses: unknown[] = [];
    const queuedSnapshots: unknown[] = [];
    const saved: Array<Record<string, unknown>> = [];
    const { bot, calls } = await createSmokeBot({
      checkSmartContractAddress: async () => smartContractReportForTest(),
      queueWhereIsMoneyJob: async (input) => {
        queued.push("where");
        queuedAnalyses.push(input.contractSafetyAnalysis);
        queuedSnapshots.push(input.fastRiskSnapshot);
        return whereIsMoneyJobForTest({ id: "where-contract" });
      },
      queueDeepForensicJob: async (input) => {
        queued.push("deep");
        queuedAnalyses.push(input.contractSafetyAnalysis);
        queuedSnapshots.push(input.fastRiskSnapshot);
        return whereIsMoneyJobForTest({ id: "deep-contract", kind: "address_deep_check" });
      },
      saveAddressFastCheckJob: async (input) => {
        saved.push(input.resultJson);
        return whereIsMoneyJobForTest({ id: "fast-contract", kind: "address_fast_check" });
      }
    });

    await bot.handleUpdate(messageUpdate(`/check ${walletAddress}`, userId));

    expect(queued).toEqual(["where", "deep"]);
    expect(queuedAnalyses).toEqual([
      expect.objectContaining({ status: "completed", report: expect.objectContaining({ subjectAddress: walletAddress }) }),
      expect.objectContaining({ status: "completed", report: expect.objectContaining({ subjectAddress: walletAddress }) })
    ]);
    expect(queuedSnapshots).toEqual([
      expect.objectContaining({ score: 59, level: "MEDIUM", reasons: expect.arrayContaining([expect.objectContaining({ code: "contract_safety_address_is_smart_contract" })]) }),
      expect.objectContaining({ score: 59, level: "MEDIUM", reasons: expect.arrayContaining([expect.objectContaining({ code: "contract_safety_address_is_smart_contract" })]) })
    ]);
    expect(saved[0]).toMatchObject({
      fastRiskReport: expect.objectContaining({ score: 59, level: "MEDIUM" }),
      contractSafetyAnalysis: {
        status: "completed",
        report: expect.objectContaining({ subjectAddress: walletAddress })
      }
    });
    expect(lastPlainText(calls)).toContain("transfer analysis continues");
  });

  it("continues Fast Where and Deep when contract safety is unavailable", async () => {
    let queueCalls = 0;
    const queuedAnalyses: unknown[] = [];
    const saved: Array<Record<string, unknown>> = [];
    const { bot, calls } = await createSmokeBot({
      checkSmartContractAddress: async () => {
        throw new Error("contract metadata unavailable");
      },
      queueWhereIsMoneyJob: async (input) => {
        queueCalls += 1;
        queuedAnalyses.push(input.contractSafetyAnalysis);
        return whereIsMoneyJobForTest({ id: "where-unavailable" });
      },
      queueDeepForensicJob: async (input) => {
        queueCalls += 1;
        queuedAnalyses.push(input.contractSafetyAnalysis);
        return whereIsMoneyJobForTest({ id: "deep-unavailable", kind: "address_deep_check" });
      },
      saveAddressFastCheckJob: async (input) => {
        saved.push(input.resultJson);
        return whereIsMoneyJobForTest({ id: "fast-unavailable", kind: "address_fast_check" });
      }
    });

    await bot.handleUpdate(messageUpdate(`/check ${walletAddress}`, userId));

    expect(queueCalls).toBe(2);
    expect(queuedAnalyses).toEqual([
      { status: "unavailable", error: "contract metadata unavailable" },
      { status: "unavailable", error: "contract metadata unavailable" }
    ]);
    expect(saved[0]).toMatchObject({
      contractSafetyAnalysis: { status: "unavailable", error: "contract metadata unavailable" }
    });
    expect(lastPlainText(calls)).toContain("Contract safety unavailable");
    expect(lastPlainText(calls)).toContain("transfer analysis continues");
  });

  it("persists completed contract safety and merged Fast context in default Where and Deep queue progress", async () => {
    const { db, progressByKind } = createQueuedForensicJobCaptureDb();
    const report = smartContractReportForTest();
    const { bot } = await createSmokeBot({
      db,
      checkSmartContractAddress: async () => report
    });

    await bot.handleUpdate(messageUpdate(`/check ${walletAddress}`, userId));

    expect([...progressByKind.keys()].sort()).toEqual(["address_deep_check", "where_is_money_check"]);
    for (const kind of ["where_is_money_check", "address_deep_check"] as const) {
      const progress = progressByKind.get(kind);
      expect(progress?.contractSafetyAnalysis).toEqual({ status: "completed", report });
      expect(progress?.fastRiskSnapshot).toMatchObject({
        score: 59,
        level: "MEDIUM",
        reasons: expect.arrayContaining([
          expect.objectContaining({ code: "contract_safety_address_is_smart_contract" })
        ])
      });
    }
  });

  it("preserves contract safety errors in default Where and Deep queue progress", async () => {
    const { db, progressByKind } = createQueuedForensicJobCaptureDb();
    const { bot } = await createSmokeBot({
      db,
      checkSmartContractAddress: async () => {
        throw new Error("contract metadata unavailable");
      }
    });

    await bot.handleUpdate(messageUpdate(`/check ${walletAddress}`, userId));

    expect([...progressByKind.keys()].sort()).toEqual(["address_deep_check", "where_is_money_check"]);
    for (const kind of ["where_is_money_check", "address_deep_check"] as const) {
      const progress = progressByKind.get(kind);
      expect(progress?.contractSafetyAnalysis).toEqual({
        status: "unavailable",
        error: "contract metadata unavailable"
      });
      expect(progress?.fastRiskSnapshot).toEqual({ score: 0, level: "LOW", reasons: [] });
    }
  });

  it("keeps ordinary Fast, Where, and Deep behavior unchanged when contract safety is not applicable", async () => {
    const queued: string[] = [];
    const queuedAnalyses: unknown[] = [];
    const queuedSnapshots: unknown[] = [];
    const saved: Array<Record<string, unknown>> = [];
    const { bot, calls } = await createSmokeBot({
      checkSmartContractAddress: async () => null,
      queueWhereIsMoneyJob: async (input) => {
        queued.push("where");
        queuedAnalyses.push(input.contractSafetyAnalysis);
        queuedSnapshots.push(input.fastRiskSnapshot);
        return whereIsMoneyJobForTest({ id: "where-eoa-job" });
      },
      queueDeepForensicJob: async (input) => {
        queued.push("deep");
        queuedAnalyses.push(input.contractSafetyAnalysis);
        queuedSnapshots.push(input.fastRiskSnapshot);
        return whereIsMoneyJobForTest({ id: "deep-eoa-job", kind: "address_deep_check" });
      },
      saveAddressFastCheckJob: async (input) => {
        saved.push(input.resultJson);
        return whereIsMoneyJobForTest({ id: "fast-eoa-job", kind: "address_fast_check" });
      }
    });

    await bot.handleUpdate(messageUpdate(`/check ${walletAddress}`, userId));

    expect(queued).toEqual(["where", "deep"]);
    expect(queuedAnalyses).toEqual([{ status: "not_applicable" }, { status: "not_applicable" }]);
    expect(queuedSnapshots).toEqual([
      { score: 0, level: "LOW", reasons: [] },
      { score: 0, level: "LOW", reasons: [] }
    ]);
    expect(saved[0]).toMatchObject({
      fastRiskReport: { score: 0, level: "LOW", reasons: [] },
      contractSafetyAnalysis: { status: "not_applicable" }
    });
    const text = lastPlainText(calls);
    expect(text).not.toContain("Contract safety completed;");
    expect(text).not.toContain("Contract safety unavailable;");
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

    expect(plainTelegramText(message.text)).toContain("Проверка контракта");
    expect(plainTelegramText(message.text)).toContain("Итоговая оценка не рассчитана");
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

  it("keeps the runtime marker out of ordinary address checks when configured", async () => {
    const { bot, calls } = await createSmokeBot({
      runtimeInstanceLabel: "Hermes test · codex/hermes-telegram-test-20260526 · 46fd9eb"
    });

    await bot.handleUpdate(messageUpdate(`/check ${walletAddress}`, userId));

    expect(lastPlainText(calls)).not.toContain("Runtime: Hermes test · codex/hermes-telegram-test-20260526 · 46fd9eb");
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

  it("returns a compact no-final result from check_status until matching Deep evidence exists", async () => {
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
      }),
      getLatestDeepForensicCheckJobForAddressAnyStatus: async () => null
    });

    await bot.handleUpdate(messageUpdate("/check_status where-job-1", userId));

    const normal = lastPlainText(calls);
    await bot.handleUpdate(messageUpdate("/check_status where-job-1 detailed", userId));
    const detailed = lastPlainText(calls);

    expectCompactNoFinalNarrative(normal);
    expect(normal).toContain("fresh DeepCheck");
    expect(normal).not.toContain("Runtime: worker-a");
    expect(normal).not.toContain("Deep forensic status");
    expect(detailed).toContain("Detailed address report");
    expect(detailed).toContain("Decision: NO_FINAL_DECISION.");
    expect(detailed).toContain("fresh DeepCheck");
    expect(detailed).not.toMatch(/\d+\/100/);
  });

  it("keeps support details out of normal check_status when detailed is not requested", async () => {
    const whereReport = whereIsMoneyReportForTest({ riskScore: 25 });
    const { bot, calls } = await createSmokeBot({
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
    expectCompactNoFinalNarrative(text);
    expect(text).not.toContain("Where-is-money — support/debug");
    expect(text).not.toContain("Job: where-job-1");
    expect(text).not.toContain("Расширенный отчёт по адресу");
    expect(text).not.toContain("Detailed address report");
  });

  it.each([undefined, "scoring-signal-matrix-v1", "scoring-signal-matrix-v2"])(
    "preserves a %s policy stored Where outcome in normal check_status",
    async (scoringPolicyVersion) => {
      const legacyReport = whereIsMoneyReportForTest({
        scoringPolicyVersion,
        scoreValid: false,
        scoreBlockedReason: "insufficient_coverage",
        technicalStatus: "provider_cap_unresolved",
        decision: "REVIEW",
        userDecision: "REVIEW",
        internalDecision: "REVIEW",
        riskScore: 45,
        assessment: {
          ...whereAssessmentForTest({ decision: "REVIEW", riskScore: 45 }),
          scoreValid: false,
          scoreBlockedReason: "insufficient_coverage",
          technicalStatus: "provider_cap_unresolved",
          decision: "REVIEW",
          riskScore: 45
        }
      });
      if (scoringPolicyVersion === undefined) delete legacyReport.scoringPolicyVersion;
      const { bot, calls } = await createSmokeBot({
        getForensicCheckJob: async (id) => whereIsMoneyJobForTest({
          id,
          resultJson: {
            ...(scoringPolicyVersion === undefined ? {} : { scoringPolicyVersion }),
            subjectAddress: legacyReport.subjectAddress,
            whereIsMoneyReport: legacyReport
          }
        })
      });

      await bot.handleUpdate(messageUpdate("/check_status where-job-legacy", userId));

      const text = lastPlainText(calls);
      expect(text).toContain("Legacy result");
      expect(text).toContain("REVIEW");
      expect(text).toContain("45/100");
      expect(text).toContain("run a fresh check");
      expect(text).not.toContain("NO_FINAL_DECISION");
      expect(text).not.toContain("Where-is-money — support/debug");
    }
  );

  it("returns a detailed address report for a where-is-money job when requested by a Russian user", async () => {
    const whereReport = whereIsMoneyReportForTest({ riskScore: 25 });
    const deepReport = deepReportForTest();
    const whereJob = whereIsMoneyJobForTest({
      id: "where-job-1",
      progressJson: { contractSafetyAnalysis: { status: "completed", report: exactVerify20ContractReportForTest() } },
      resultJson: {
        subjectAddress: whereReport.subjectAddress,
        whereIsMoneyReport: whereReport
      }
    });
    const deepJob = whereIsMoneyJobForTest({
      id: "deep-job-1",
      kind: "address_deep_check",
      resultJson: persistedDeepResultJsonForTest(deepReport)
    });
    const { bot, calls } = await createSmokeBot({
      defaultLocale: "ru",
      getForensicCheckJob: async () => whereJob,
      getLatestDeepForensicCheckJobForAddressAnyStatus: async () => deepJob
    });

    await bot.handleUpdate(messageUpdate("/check_status where-job-1 detailed", userId));

    const text = lastPlainText(calls);
    expect(text).toContain("Расширенный отчёт по адресу");
    expect(text).toContain(walletAddress);
    expect(text).toContain("85/100");
    expect(text).not.toContain("Where-is-money — support/debug");
  });

  it("returns a detailed address report for a deep forensic job when a matching where-is-money job exists", async () => {
    const whereReport = whereIsMoneyReportForTest({ riskScore: 25 });
    const deepReport = deepReportForTest();
    const deepJob = whereIsMoneyJobForTest({
      id: "deep-job-1",
      kind: "address_deep_check",
      progressJson: { contractSafetyAnalysis: { status: "completed", report: exactVerify20ContractReportForTest() } },
      resultJson: persistedDeepResultJsonForTest(deepReport)
    });
    const whereJob = whereIsMoneyJobForTest({
      id: "where-job-1",
      resultJson: {
        subjectAddress: whereReport.subjectAddress,
        whereIsMoneyReport: whereReport
      }
    });
    const { bot, calls } = await createSmokeBot({
      getForensicCheckJob: async () => deepJob,
      getLatestWhereIsMoneyCheckJobForAddress: async () => whereJob
    });

    await bot.handleUpdate(messageUpdate("/check_status deep-job-1 detailed", userId));

    const text = lastPlainText(calls);
    expect(text).toContain("Detailed address report");
    expect(text).toContain(walletAddress);
    expect(text).toContain("85/100");
    expect(text).not.toContain("Deep forensic status");
  });

  it("shows current Deep context instead of a legacy Where outcome in detailed Deep status", async () => {
    const deepReport = deepReportForTest({
      stablecoinRestrictionProfiles: [stablecoinRestrictionProfile({ subjectAddress: walletAddress })]
    });
    const deepJob = whereIsMoneyJobForTest({
      id: "deep-job-current-with-legacy-where",
      kind: "address_deep_check",
      resultJson: persistedDeepResultJsonForTest(deepReport)
    });
    const legacyWhere = whereIsMoneyReportForTest({
      scoringPolicyVersion: "scoring-signal-matrix-v1",
      decision: "REVIEW",
      userDecision: "REVIEW",
      internalDecision: "REVIEW",
      riskScore: 45
    });
    const legacyWhereJob = whereIsMoneyJobForTest({
      id: "where-job-legacy-for-current-deep",
      resultJson: {
        scoringPolicyVersion: "scoring-signal-matrix-v1",
        subjectAddress: walletAddress,
        whereIsMoneyReport: legacyWhere
      }
    });
    const { bot, calls } = await createSmokeBot({
      getForensicCheckJob: async () => deepJob,
      getLatestWhereIsMoneyCheckJobForAddress: async () => legacyWhereJob
    });

    await bot.handleUpdate(messageUpdate("/check_status deep-job-current-with-legacy-where detailed", userId));

    const text = lastPlainText(calls);
    expect(text).toContain("Address behavior — context ready");
    expect(text).not.toContain("Legacy result");
    expect(text).not.toContain("45/100");
  });

  it("does not show malformed persisted Deep hard evidence in detailed check_status", async () => {
    const whereReport = whereIsMoneyReportForTest({ riskScore: 25 });
    const deepReport = deepReportForTest();
    const deepResult = persistedDeepResultJsonForTest(deepReport);
    deepResult.approvalDrainProvenanceProfiles = [{
      evidenceStrength: "exact_approval_and_transfer_from",
      score: 95
    }];
    deepResult.stablecoinRestrictionProfiles = [{
      isBlacklisted: true
    }];
    deepResult.assetContinuationProfiles = [{
      evidenceClass: "asset_continuation",
      tokenQuality: "verified",
      score: 84,
      reasons: ["Malformed asset continuation should be ignored."]
    }];
    const deepJob = whereIsMoneyJobForTest({
      id: "deep-job-1",
      kind: "address_deep_check",
      resultJson: deepResult
    });
    const whereJob = whereIsMoneyJobForTest({
      id: "where-job-1",
      resultJson: {
        subjectAddress: whereReport.subjectAddress,
        whereIsMoneyReport: whereReport
      }
    });
    const { bot, calls } = await createSmokeBot({
      defaultLocale: "ru",
      getForensicCheckJob: async () => deepJob,
      getLatestWhereIsMoneyCheckJobForAddress: async () => whereJob
    });

    await bot.handleUpdate(messageUpdate("/check_status deep-job-1 detailed", userId));

    const text = lastPlainText(calls);
    expect(text).toContain("Расширенный отчёт по адресу");
    expect(text).not.toContain("Найдена точная drainer-цепочка");
    expect(text).not.toContain("Адрес находится в активном TRC20 USDT blacklist");
    expect(text).not.toContain("Найдена cross-chain или asset-continuation связь");
    expect(text).not.toContain("Malformed asset continuation should be ignored");
  });

  it("explains that detailed final report needs a completed where-is-money job", async () => {
    const deepReport = deepReportForTest();
    const deepJob = whereIsMoneyJobForTest({
      id: "deep-job-1",
      kind: "address_deep_check",
      resultJson: persistedDeepResultJsonForTest(deepReport)
    });
    const { bot, calls } = await createSmokeBot({
      defaultLocale: "ru",
      getForensicCheckJob: async () => deepJob,
      getLatestWhereIsMoneyCheckJobForAddress: async () => null
    });

    await bot.handleUpdate(messageUpdate("/check_status deep-job-1 detailed", userId));

    expect(lastPlainText(calls)).toContain("Подробный итоговый отчёт доступен после завершённой проверки “Откуда деньги”.");
  });

  it("supports Russian подробно alias for detailed check_status", async () => {
    const whereReport = whereIsMoneyReportForTest({ riskScore: 25 });
    const { bot, calls } = await createSmokeBot({
      defaultLocale: "ru",
      getForensicCheckJob: async () => whereIsMoneyJobForTest({
        id: "where-job-1",
        resultJson: {
          subjectAddress: whereReport.subjectAddress,
          whereIsMoneyReport: whereReport
        }
      }),
      getLatestDeepForensicCheckJobForAddressAnyStatus: async () => null
    });

    await bot.handleUpdate(messageUpdate("/check_status where-job-1 подробно", userId));

    expect(lastPlainText(calls)).toContain("Расширенный отчёт по адресу");
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

    expectCompactNoFinalNarrative(text);
    expect(text).not.toContain("DeepCheck");
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
          fundingTxHash: "funding-135k",
          startTimestamp: "2026-05-05T13:57:27.000Z",
          endTimestamp: "2026-05-05T15:00:30.000Z",
          episodeOutgoingRaw: "1000000000",
          episodeSelectedRaw: "200000000",
          episodeCoverageRatio: 0.2,
          outgoingTxHashes: ["out-1", "out-2"],
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

    expectCompactScoredNarrative(text, 70);
    expect(text).not.toContain("selected drain episode");
    expect(text).not.toContain("anchor coverage 50%");
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

    expectCompactNoFinalNarrative(text);
    expect(text).not.toContain("recent-flow");
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

    expectCompactScoredNarrative(text, 55);
    expect(text).toContain("Поставьте операцию на паузу");
    expect(text).not.toContain("Решение: REVIEW");
    expect(text).not.toContain("Что делать");
    expect(text).not.toContain("Почему");
    expect(text).not.toContain("Что важно учесть");
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

    expectCompactScoredNarrative(text, 55);
    expect(text).not.toContain("source-policy threshold");
    expect(text).not.toContain("Точных признаков кражи, drainer-цепочки или USDT blacklist не найдено.");
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

    expectCompactScoredNarrative(text, 95);
    expect(text).toContain("309 000 USDT");
    expect(text).toContain("дрейнер-цепочке");
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
    expect(text).not.toContain("Exact approval-drain не найден.");
    expect(text).not.toContain("USDT blacklist не найден.");
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
        launderingPatternScore: 90,
        dominantRiskType: "laundering_pattern",
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

    expectCompactScoredNarrative(text, 59);
    expect(text).toContain("Быстрая проверка выявила транзитное движение средств через кошелёк");
    expect(text).not.toContain("forensic_address_behavior");
    expect(text).not.toContain("Address shows high-volume transit-like behavior");
    expect(text).not.toContain("Hard evidence");
    expect(text).not.toContain("Жёсткое доказательство");
  });

  it.each([
    ["address_behavior_deposit_then_drain", "Кошелёк получает средства и вскоре переводит их дальше"],
    ["address_behavior_fast_post_deposit_exit", "Кошелёк получает средства и вскоре переводит их дальше"],
    ["address_behavior_large_inflow_preserved_outflow", "Кошелёк получил значительное поступление и перевёл дальше большую часть суммы"],
    ["address_behavior_drain_to_service_infrastructure", "Кошелёк направил значительную часть поступивших средств в сервисную инфраструктуру"],
    ["address_behavior_high_volume_transit", "Через кошелёк проходит много входящих и исходящих переводов"],
    ["address_behavior_fan_in_fan_out", "Через кошелёк проходит много входящих и исходящих переводов"],
    ["address_behavior_collector_like_wallet", "Кошелёк собирает поступления и переводит средства дальше"],
    ["address_behavior_large_outgoing_concentration", "Большая часть исходящих средств направляется основным получателям"],
    ["address_behavior_top_counterparty_concentration", "Большая часть исходящих средств направляется основным получателям"]
  ])("explains canonical Fast behavior %s without raw fields", (code, expected) => {
    const text = formatUnifiedAddressFinalReportForTest({
      address: walletAddress,
      whereReport: whereIsMoneyReportForTest(),
      fastReport: riskReportForTest({
        level: "CRITICAL",
        score: 90,
        launderingPatternScore: 90,
        dominantRiskType: "laundering_pattern",
        reasons: [{
          code,
          message: "RAW FAST MESSAGE MUST NOT LEAK",
          scoreImpact: 90,
          evidenceRef: `fast-evidence:${code}`
        }]
      }),
      locale: "ru"
    });

    expectCompactScoredNarrative(text, 59);
    expect(text).toContain(expected);
    expect(text).not.toContain(code);
    expect(text).not.toContain("RAW FAST MESSAGE MUST NOT LEAK");
  });

  it("selects the strongest recognized Fast behavior reason instead of the first stored reason", () => {
    const text = formatUnifiedAddressFinalReportForTest({
      address: walletAddress,
      whereReport: whereIsMoneyReportForTest(),
      fastReport: riskReportForTest({
        level: "CRITICAL",
        score: 90,
        launderingPatternScore: 90,
        dominantRiskType: "laundering_pattern",
        reasons: [
          {
            code: "address_behavior_large_outgoing_concentration",
            message: "RAW LOW IMPACT MUST NOT LEAK",
            scoreImpact: 10,
            evidenceRef: "fast-evidence:low"
          },
          {
            code: "address_behavior_high_volume_transit",
            message: "RAW HIGH IMPACT MUST NOT LEAK",
            scoreImpact: 90,
            evidenceRef: "fast-evidence:high"
          }
        ]
      }),
      locale: "ru"
    });

    expect(text).toContain("Через кошелёк проходит много входящих и исходящих переводов");
    expect(text).not.toContain("Большая часть исходящих средств направляется основным получателям");
    expect(text).not.toContain("RAW LOW IMPACT MUST NOT LEAK");
    expect(text).not.toContain("RAW HIGH IMPACT MUST NOT LEAK");
  });

  it("keeps the winning Fast behavior reason beside secondary bridge, collector, and risky-counterparty facts", () => {
    const deepReport = freshNarrativeDeepReportForTest({
      boundaryExposureProfiles: [boundaryExposureProfile()],
      addressBehaviorProfiles: [{
        subjectAddress: walletAddress,
        incomingVolumeRaw: "100000000000",
        outgoingVolumeRaw: "90000000000",
        incomingTxCount: 5,
        outgoingTxCount: 5,
        uniqueIncomingCounterparties: 3,
        uniqueOutgoingCounterparties: 3,
        largestIncomingRaw: "30000000000",
        largestOutgoingRaw: "40000000000",
        topOutgoingCounterpartyAddress: secondWalletAddress,
        topOutgoingCounterpartyRaw: "50000000000",
        topOutgoingCounterpartyTxCount: 2,
        topOutgoingCounterpartyRatio: 0.55,
        inflowToOutflowRatio: 0.9,
        drainToServiceRatio: 0,
        timeToFirstOutgoingMs: 60_000,
        timeToFirstServiceExitMs: null,
        depositThenDrainScore: 0,
        transitScore: 10,
        dampenerScore: 0,
        features: [{
          code: "address_behavior_collector_like_wallet",
          label: "RAW COLLECTOR MESSAGE MUST NOT LEAK",
          scoreImpact: 10
        }]
      }],
      operationalFlowProfiles: [operationalFlowProfile({
        incomingVolumeRaw: "100000000000",
        outgoingVolumeRaw: "10000000000",
        inflowToOutflowRatio: 0.1,
        topOutgoingCounterparties: [{
          address: "THTX11111111111111111111111111111111",
          direction: "outgoing",
          volumeRaw: "10000000000",
          txCount: 1,
          volumeRatio: 1,
          category: "cex",
          identity: "HTX",
          isTerminalLiquidity: true,
          isHtxHuobi: true
        }],
        bridgeDexRouterOutgoingRatio: 0,
        unknownContractOutgoingRatio: 0
      })],
      directCounterpartyInteractionProfiles: [{
        subjectAddress: walletAddress,
        direction: "inbound",
        counterpartyAddress: secondWalletAddress,
        volumeRaw: "10000000",
        volumeRatio: 0.1,
        txCount: 1,
        firstSeen: "2026-05-10T01:00:00.000Z",
        lastSeen: "2026-05-10T01:00:00.000Z",
        txHashes: ["tx-secondary-risky"],
        transfers: [{
          txHash: "tx-secondary-risky",
          fromAddress: secondWalletAddress,
          toAddress: walletAddress,
          amountRaw: "10000000",
          timestamp: "2026-05-10T01:00:00.000Z",
          method: "transfer",
          edgeType: "normal_transfer"
        }],
        serviceCategory: null,
        identity: null,
        snapshot: {
          address: secondWalletAddress,
          riskScore: 70,
          riskLevel: "HIGH",
          source: "fast_address_check",
          evidenceClass: "counterparty_behavior_context",
          reasons: [],
          partialNotes: []
        },
        interactionWeight: 0.1,
        scoreContribution: 10,
        evidenceClass: "counterparty_behavior_context",
        skippedReason: null
      }]
    });
    const code = "address_behavior_high_volume_transit";
    const text = formatUnifiedAddressFinalReportForTest({
      address: walletAddress,
      whereReport: whereIsMoneyReportForTest(),
      deepReport,
      fastReport: riskReportForTest({
        level: "CRITICAL",
        score: 90,
        launderingPatternScore: 90,
        dominantRiskType: "laundering_pattern",
        reasons: [{
          code,
          message: "RAW WINNER MUST NOT LEAK",
          scoreImpact: 90,
          evidenceRef: "fast-evidence:high-volume-transit"
        }]
      }),
      locale: "ru"
    });

    expectCompactScoredNarrative(text, 59);
    expect(text).toContain("Через кошелёк проходит много входящих и исходящих переводов");
    expect(text).not.toContain(code);
    expect(text).not.toContain("RAW WINNER MUST NOT LEAK");
  });

  it("explains an exact Fast internal label for the checked address without leaking raw fields", () => {
    const text = formatUnifiedAddressFinalReportForTest({
      address: walletAddress,
      whereReport: whereIsMoneyReportForTest(),
      fastReport: riskReportForTest({
        level: "CRITICAL",
        score: 90,
        reasons: [{
          code: "internal_label_scam",
          message: "RAW ADMIN LABEL MUST NOT LEAK",
          scoreImpact: 90,
          evidenceRef: "label:scam:wallet"
        }]
      }),
      locale: "ru"
    });

    expectCompactScoredNarrative(text, 90);
    expect(text).toContain("Проверяемый адрес отмечен во внутренней базе как мошеннический");
    expect(text).not.toContain("internal_label_scam");
    expect(text).not.toContain("RAW ADMIN LABEL MUST NOT LEAK");
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

    expectCompactNoFinalNarrative(text);
    expect(text).toContain("повтор");
    expect(text).not.toContain("Blocked reason");
    expect(text).not.toContain("Technical status");
  });

  it("keeps contextual Fast risk diagnostic when new Where coverage blocks a final score", () => {
    const whereReport = scoreInvalidWhereReportForTest();
    const fastReport: RiskReport = {
      subjectAddress: whereReport.subjectAddress,
      score: 90,
      level: "CRITICAL",
      reasons: [{ code: "critical_context_only", message: "context only", scoreImpact: 90 }]
    };

    const text = formatUnifiedAddressFinalReportForTest({
      address: whereReport.subjectAddress,
      whereReport,
      fastReport,
      locale: "en"
    });
    const betaText = formatUnifiedAddressFinalReportForTest({
      address: whereReport.subjectAddress,
      whereReport,
      fastReport,
      locale: "en",
      showBetaDiagnostics: true
    });

    expectCompactNoFinalNarrative(text);
    expect(betaText).toContain("Beta/internal");
    expect(betaText).toContain("Final risk diagnostic:");
    expect(text).not.toContain("Final risk: 59");
  });

  it("keeps raw coverage caveats out of Russian user-facing limits", () => {
    const base = scoreInvalidWhereReportForTest();
    const rawCaveats = [
      "Provider cap stopped the first source branch.",
      "Second branch needs an older transfer page.",
      "Third branch returned an inconsistent cursor.",
      "Fourth branch exceeded the local retry budget.",
      "Fifth branch has incomplete provider history.",
      "Sixth branch remains unresolved after retries."
    ];
    const whereReport: WhereIsMoneyReport = {
      ...base,
      coverage: { ...base.coverage, notes: rawCaveats.slice(0, 5) },
      assessment: { ...base.assessment, warnings: rawCaveats.slice(5) }
    };

    const text = formatUnifiedAddressFinalReportForTest({
      address: whereReport.subjectAddress,
      whereReport,
      deepReport: deepReportForTest({
        boundaryExposureProfiles: [boundaryExposureProfile()]
      }),
      locale: "ru"
    });

    for (const caveat of rawCaveats) expect(text).not.toContain(caveat);
    expectCompactNoFinalNarrative(text);
    expect(text).not.toContain("это не означает полную историю адреса");
  });

  it("keeps exact hard decline while showing invalid partial Where limitations", () => {
    const base = scoreInvalidWhereReportForTest();
    const whereReport: WhereIsMoneyReport = {
      ...base,
      proofLevel: "exact_scam_or_taint_proof",
      assessment: {
        ...base.assessment,
        hardBadEvidence: [{
          kind: "scam_or_blacklist",
          score: 95,
          message: "Exact subject blacklist evidence.",
          evidenceIds: ["hard:subject:blacklist"]
        }]
      }
    };

    const text = formatUnifiedAddressFinalReportForTest({
      address: whereReport.subjectAddress,
      whereReport,
      locale: "en"
    });

    expectCompactScoredNarrative(text, 95);
    expect(text).toContain("Do not proceed");
  });

  it.each([undefined, "scoring-signal-matrix-v1", "scoring-signal-matrix-v2"])(
    "renders a %s policy Where result without rescoring it even when score validity is explicit",
    (scoringPolicyVersion) => {
    const legacy = whereIsMoneyReportForTest({
      decision: "REVIEW",
      userDecision: "REVIEW",
      internalDecision: "REVIEW",
      riskScore: 45,
      assessment: {
        ...whereAssessmentForTest({ decision: "REVIEW", riskScore: 45 }),
        decision: "REVIEW",
        riskScore: 45,
        riskBand: "MEDIUM"
      }
    });
    if (scoringPolicyVersion === undefined) {
      delete legacy.scoringPolicyVersion;
    } else {
      legacy.scoringPolicyVersion = scoringPolicyVersion;
    }

    const text = formatUnifiedAddressFinalReportForTest({
      address: legacy.subjectAddress,
      whereReport: legacy,
      locale: "en"
    });

    expect(text).toContain("Legacy result");
    expect(text).toContain("REVIEW");
    expect(text).toContain("45/100");
    expect(text).toContain("run a fresh check");
    }
  );

  it("does not reuse an unmarked related Deep hard-evidence report in current scoring", () => {
    const legacyDeep = deepReportForTest({
      approvalDrainProvenanceProfiles: [{
        victimAddress: "TVictim111111111111111111111111111111",
        approvalTxHash: "tx-approval",
        drainTxHash: "tx-drain",
        spenderAddress: "TSpender11111111111111111111111111111",
        firstReceiverAddress: walletAddress,
        subjectAddress: walletAddress,
        hopDepth: 0,
        amountRaw: "1000000000",
        amountPreservationRatio: 1,
        approvalAt: "2026-05-20T09:50:00.000Z",
        drainAt: "2026-05-20T10:00:00.000Z",
        pathTxHashes: ["tx-drain"],
        pathAddresses: [walletAddress],
        score: 95,
        evidenceStrength: "exact_approval_and_transfer_from",
        subjectTokenState: null,
        victimTokenState: null,
        features: []
      }]
    });
    delete legacyDeep.scoringPolicyVersion;

    const text = formatUnifiedAddressFinalReportForTest({
      address: walletAddress,
      whereReport: whereIsMoneyReportForTest({ riskScore: 20 }),
      deepReport: legacyDeep,
      locale: "en"
    });

    expect(text).not.toContain("95/100");
  });

  it("keeps a legacy Where outcome when paired with a current Deep report", () => {
    const legacyWhere = whereIsMoneyReportForTest({
      scoringPolicyVersion: "scoring-signal-matrix-v1",
      decision: "REVIEW",
      userDecision: "REVIEW",
      internalDecision: "REVIEW",
      riskScore: 45
    });
    const currentDeep = deepReportForTest({
      stablecoinRestrictionProfiles: [stablecoinRestrictionProfile({ subjectAddress: walletAddress })]
    });
    const currentDeepJob = whereIsMoneyJobForTest({
      kind: "address_deep_check",
      resultJson: persistedDeepResultJsonForTest(currentDeep)
    });

    const text = plainTelegramText(formatWhereIsMoneyUserDeliveryReport(
      whereIsMoneyJobForTest(),
      legacyWhere,
      "completed",
      currentDeepJob,
      { locale: "en" }
    ).text);

    expect(text).toContain("Legacy result");
    expect(text).toContain("REVIEW");
    expect(text).toContain("45/100");
    expect(text).not.toContain("90/100");
  });

  it("keeps automatic current Deep delivery standalone when matching Where is legacy", () => {
    const currentDeep = deepReportForTest({
      stablecoinRestrictionProfiles: [stablecoinRestrictionProfile({ subjectAddress: walletAddress })]
    });
    const deepJob = whereIsMoneyJobForTest({
      kind: "address_deep_check",
      resultJson: persistedDeepResultJsonForTest(currentDeep)
    });
    const legacyWhere = whereIsMoneyReportForTest({
      scoringPolicyVersion: "scoring-signal-matrix-v1",
      decision: "REVIEW",
      userDecision: "REVIEW",
      internalDecision: "REVIEW",
      riskScore: 45
    });
    const legacyWhereJob = whereIsMoneyJobForTest({
      resultJson: {
        scoringPolicyVersion: "scoring-signal-matrix-v1",
        subjectAddress: walletAddress,
        whereIsMoneyReport: legacyWhere
      }
    });

    const text = plainTelegramText(formatDeepForensicUserDeliveryReport(
      deepJob,
      currentDeep,
      "completed",
      legacyWhereJob,
      { locale: "en" }
    ).text);

    expect(text).toContain("Address behavior — context ready");
    expect(text).not.toContain("Legacy result");
    expect(text).not.toContain("45/100");
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

    expectCompactScoredNarrative(text, 0);
    expect(text).not.toContain("recent-flow anchor");
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

    expectCompactScoredNarrative(text, 95);
    expect(text).not.toContain("Решение: DECLINE");
    expect(text).toContain("первым получил 309 000 USDT");
    expect(text).toContain("подтверждённой дрейнер-цепочке");
    expect((text.match(/309 000 USDT/g) ?? []).length).toBe(1);
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

    expectCompactScoredNarrative(text, 95);
    expect(text).not.toContain("Решение: DECLINE");
    expect(text).toContain("первым получил 309 000 USDT");
    expect(text).not.toContain("Цепочка дошла до биржи или сервиса");
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

    expectCompactScoredNarrative(text, 10);
    expect(text).toContain("Можно принять");
    expect(text).not.toContain("Решение: ACCEPTABLE");
    expect(text).not.toContain("Почему");
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

    expectCompactNoFinalNarrative(text);
    expect(text).not.toContain("guaranteed clean");
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

    expectCompactScoredNarrative(text, 29);
    expect(text).toContain("Matrix row: clean_or_operational; matrix decision: ACCEPTABLE.");
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

    expectCompactScoredNarrative(text, 29);
    expect(text).toContain("Matrix row: clean_or_operational; matrix decision: ACCEPTABLE.");
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

    expect(defaultText).not.toContain("Beta/internal");
    expect(diagnosticText).toContain("Beta/internal");
    expect(diagnosticText).toContain("Final risk diagnostic:");
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

    expectCompactScoredNarrative(text, 0);
    expect(text).not.toContain("HTX/Huobi funds 70% of the selected amount.");
    expect(text).not.toContain("Historical HTX/Huobi exposure is context, not selected-amount source proof.");
    expect(text).not.toContain("The graph stopped before resolving a material bridge/router/DEX boundary.");
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

    expectCompactScoredNarrative(text, 0);
    expect(text).not.toContain("The graph stopped before resolving a material HTX/Huobi source boundary.");
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

    expectCompactScoredNarrative(text, 90);
    expect(text).not.toContain("Exact approval-drain evidence was found");
    expect(text).not.toContain("Hard evidence: Internal label: scam");
    expect(text).not.toContain("HTX/Huobi funds 70% of the selected amount.");
    expect(text).not.toContain("Historical HTX/Huobi exposure is context, not selected-amount source proof.");
    expect(text).not.toContain("The graph stopped before resolving a material bridge/router/DEX boundary.");
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

    expectCompactScoredNarrative(text, 45);
    const scores = text.match(/\d+\/100/g) ?? [];
    expect(scores).toHaveLength(1);
    expect(scores[0]).not.toBe("25/100");
    expect(Number(scores[0]?.split("/")[0])).toBeGreaterThan(25);
    expect(text).not.toContain("Риск поведения");
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

    expectCompactScoredNarrative(text, 45);
    const scores = text.match(/\d+\/100/g) ?? [];
    expect(scores).toHaveLength(1);
    expect(scores[0]).not.toBe("25/100");
    expect(Number(scores[0]?.split("/")[0])).toBeGreaterThan(25);
    expect(text).not.toContain("Behavior risk");
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

    expectCompactNoFinalNarrative(text);
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

    expect(text).toContain("Anchored by: collector_transit_behavior 35.");
    expect(text).toContain("Matrix row: behavior_only_prior; matrix decision: REVIEW.");
    expect(text).toContain("Run profile: bounded_rerun.");
    expect(text).toContain("Provider budget: calls 20, transfers 10, contracts 0, approvals 0, elapsed 30000 ms, exhausted no.");
    expect(text).toContain("Weighted layer score:");
    expectCompactScoredNarrative(text, 35);
    expect(text).toContain("Pause");
  });

  it("shows only the resolved asset-continuation floor in the unified final report", () => {
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

    expect(text).not.toContain("Policy floor: 70");
    expect(text).toContain("Asset continuation floor: 82");
    expect(text).toContain("Context score: 78.");
    expectCompactScoredNarrative(text, 82);
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

    expect(extractWhereIsMoneyReportFromJob(matchingJob, walletAddress)).toEqual(whereReport);
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

  it("[AC-39][REQ-25][LLM-PROJECTION] keeps a current deterministic Where report when prose names legacy model tokens", () => {
    const deterministicReason = "Deterministic policy: DeepSeek and legitimate_service labels do not alter the exact evidence.";
    const contractContext = {
      evidenceClass: "contract_suspicion" as const,
      kind: "provider_contract_context",
      score: 35,
      rawScore: 35,
      adjustedScore: 35,
      proofLevel: "exchange_policy_context" as const,
      canBeDampened: true,
      reasons: [deterministicReason],
      warnings: [],
      evidenceIds: ["provider:subject"]
    };
    const report = whereIsMoneyReportForTest({
      decision: "REVIEW",
      userDecision: "REVIEW",
      internalDecision: "REVIEW",
      riskScore: 35,
      decisionReasons: [deterministicReason],
      assessment: {
        ...whereAssessmentForTest({ decision: "REVIEW", riskScore: 35 }),
        contractSuspicionEvidence: [contractContext],
        riskLayers: [contractContext],
        dominantRiskLayer: contractContext,
        reasons: [deterministicReason]
      }
    });
    const job = whereIsMoneyJobForTest({
      resultJson: {
        scoringPolicyVersion: SCORING_SIGNAL_MATRIX_POLICY_VERSION,
        subjectAddress: report.subjectAddress,
        whereIsMoneyReport: report
      }
    });

    expect(extractWhereIsMoneyReportFromJob(job, walletAddress)).toEqual(report);
  });

  it("[AC-39][REQ-25][LLM-STRUCTURE][WHERE-SOURCE-POLICY] rejects a legacy LLM marker stored only in source-policy evidence", () => {
    const report = whereIsMoneyReportForTest({
      decision: "REVIEW",
      userDecision: "REVIEW",
      internalDecision: "REVIEW",
      riskScore: 55,
      assessment: {
        ...whereAssessmentForTest({ decision: "REVIEW", riskScore: 55 }),
        sourcePolicyEvidence: [{
          kind: "htx_huobi",
          aggregateShare: 0.7,
          effectiveShare: 0.7,
          pathCount: 1,
          score: 55,
          riskBand: "MEDIUM",
          proofLevel: "llm_assisted_suspicion",
          canBeDampened: true,
          reasons: ["Legacy source-policy projection."],
          warnings: [],
          evidenceIds: ["legacy-source-policy"]
        }]
      }
    });
    const job = whereIsMoneyJobForTest({
      resultJson: {
        scoringPolicyVersion: SCORING_SIGNAL_MATRIX_POLICY_VERSION,
        subjectAddress: report.subjectAddress,
        whereIsMoneyReport: report
      }
    });

    expect(extractWhereIsMoneyReportFromJob(job, walletAddress)).toBeNull();
  });

  it("[AC-39][REQ-25][LLM-STRUCTURE] keeps ordinary legacy contract suspicion without an explicit LLM marker", () => {
    const contractContext = {
      evidenceClass: "contract_suspicion" as const,
      kind: "provider_contract_context",
      score: 35,
      rawScore: 35,
      adjustedScore: 35,
      proofLevel: "exchange_policy_context" as const,
      canBeDampened: true,
      reasons: ["Provider metadata requires deterministic review."],
      warnings: [],
      evidenceIds: ["provider:subject"]
    };
    const report = whereIsMoneyReportForTest({
      scoringPolicyVersion: "scoring-signal-matrix-v2",
      decision: "REVIEW",
      userDecision: "REVIEW",
      internalDecision: "REVIEW",
      riskScore: 35,
      assessment: {
        ...whereAssessmentForTest({ decision: "REVIEW", riskScore: 35 }),
        contractSuspicionEvidence: [contractContext],
        riskLayers: [contractContext],
        dominantRiskLayer: contractContext,
        reasons: contractContext.reasons
      }
    });
    const job = whereIsMoneyJobForTest({
      resultJson: {
        scoringPolicyVersion: "scoring-signal-matrix-v2",
        subjectAddress: report.subjectAddress,
        whereIsMoneyReport: report
      }
    });

    expect(extractWhereIsMoneyReportFromJob(job, walletAddress)).toEqual({
      ...report,
      contractLlmVerdicts: []
    });
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

    expectCompactScoredNarrative(text, 45);
    const scores = text.match(/\d+\/100/g) ?? [];
    expect(scores).toHaveLength(1);
    expect(scores[0]).not.toBe("25/100");
    expect(Number(scores[0]?.split("/")[0])).toBeGreaterThan(25);
    expect(text).not.toContain("Behavior risk");
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

    expectCompactScoredNarrative(text, 0);
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

    expectCompactNoFinalNarrative(text);
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

    expect(text).toContain("Final score was not calculated");
    expect(text).toContain("The data source ended the check with an error.");
    expect(text).not.toContain("Deep forensic job failed");
    expect(text).not.toContain("<provider timeout>");
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
    const malformedHardEvidenceResultJson = persistedDeepResultJsonForTest(deepReport);
    malformedHardEvidenceResultJson.approvalDrainProvenanceProfiles = [{
      evidenceStrength: "exact_approval_and_transfer_from",
      score: 95
    }];
    malformedHardEvidenceResultJson.stablecoinRestrictionProfiles = [{
      isBlacklisted: true
    }];
    malformedHardEvidenceResultJson.assetContinuationProfiles = [{
      evidenceClass: "asset_continuation",
      tokenQuality: "verified",
      score: 84,
      reasons: ["Malformed asset continuation should be ignored."]
    }];
    const malformedHardEvidenceJob = whereIsMoneyJobForTest({
      id: "deep-job-malformed-hard",
      kind: "address_deep_check",
      resultJson: malformedHardEvidenceResultJson
    });

    const extractedReport = extractDeepForensicReportFromJob(matchingJob, walletAddress);
    const malformedHardEvidenceReport = extractDeepForensicReportFromJob(malformedHardEvidenceJob, walletAddress);

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
    expect(malformedHardEvidenceReport?.approvalDrainProvenanceProfiles).toEqual([]);
    expect(malformedHardEvidenceReport?.stablecoinRestrictionProfiles).toEqual([]);
    expect(malformedHardEvidenceReport?.assetContinuationProfiles).toEqual([]);
    expect(extractDeepForensicReportFromJob(wrongSubjectJob, walletAddress)).toBeNull();
    expect(extractDeepForensicReportFromJob(invalidShapeJob, walletAddress)).toBeNull();
  });

  it("fails closed for a legacy Verify20 report without a deterministic contract decision", () => {
    const report = exactVerify20ContractReportForTest();
    const ru = plainTelegramText(formatSmartContractCheckReport(report, { locale: "ru" }).text);
    const en = plainTelegramText(formatSmartContractCheckReport(report, { locale: "en" }).text);

    expect(ru).toContain("Итоговая оценка не рассчитана");
    expect(en).toContain("Final score was not calculated");
    expect(`${ru}\n${en}`).not.toMatch(/\b\d{1,3}\/100\b|AI|LLM|confidence/i);
  });

  it.each([
    ["exact debit", "exact_debit", "exact_debit", "95/100"],
    ["Verify20", "verify20_fingerprint", "verify20_fingerprint", "90/100"],
    ["provider risk", "provider_risk", "provider_risk", "90/100"],
    ["known-service session", "known_service_session", "service_action", "10/100"],
    ["metadata context", "context", "metadata_context", "35/100"]
  ] as const)("[Task5] passes saved %s evidence through the shared contract adapter", (
    _name,
    authority,
    evidenceKind,
    expectedScore
  ) => {
    const report = freshContractDecisionReportForTest({ authority, evidenceKind });
    const sentinelAmount = "987654.321987 USDT";
    const sentinelSource = "TSourceMustNotLeak11111111111111111111";
    const sentinelReceiver = "TReceiverMustNotLeak111111111111111111";
    report.reasons = [`legacy exact debit ${sentinelAmount} from ${sentinelSource} to ${sentinelReceiver}`];
    Object.assign(report, {
      legacyExactDebitAmount: sentinelAmount,
      legacyExactDebitSourceAddress: sentinelSource,
      legacyExactDebitReceiverAddress: sentinelReceiver
    });
    const text = plainTelegramText(formatSmartContractCheckReport(report, { locale: "en" }).text);

    expect(text).toContain(expectedScore);
    expect(text).not.toContain("Final score was not calculated");
    expect(text).not.toContain("not enough validated data");
    if (authority === "exact_debit") {
      const ru = plainTelegramText(formatSmartContractCheckReport(report, { locale: "ru" }).text);
      expect(ru).toContain("Подтверждено списание USDT через проверяемый контракт.");
      expect(ru).toContain("Сохранённые данные не указывают сумму, кошелёк-источник или получателя.");
      expect(text).toContain("A USDT debit through the checked contract was confirmed.");
      expect(text).toContain("The saved evidence does not identify an amount, source wallet, or receiver.");
      for (const sentinel of [sentinelAmount, sentinelSource, sentinelReceiver]) {
        expect(ru).not.toContain(sentinel);
        expect(text).not.toContain(sentinel);
      }
    }
  });

  it.each([
    ["foreign subject", (report: SmartContractCheckReport) => {
      report.contractDecisionEvidenceV1![0]!.subjectAddress = secondWalletAddress;
    }],
    ["contradictory evidence kind", (report: SmartContractCheckReport) => {
      report.contractDecisionEvidenceV1![0]!.kind = "metadata_context";
      report.contractDecisionEvidenceV1![0]!.spenderAddress = null;
      report.contractDecisionEvidenceV1![0]!.tokenContract = null;
    }]
  ] as const)("[Task5] fails closed for %s in saved contract evidence", (_name, mutate) => {
    const report = freshContractDecisionReportForTest({
      authority: "exact_debit",
      evidenceKind: "exact_debit"
    });
    mutate(report);

    const text = plainTelegramText(formatSmartContractCheckReport(report, { locale: "en" }).text);

    expect(text).toContain("Final score was not calculated");
    expect(text).not.toContain("95/100");
  });

  it("normalizes the same persisted Verify20 report for Where-first and Deep-first final delivery", () => {
    const contractReport = exactVerify20ContractReportForTest();
    const whereReport = whereIsMoneyReportForTest({ riskScore: 25 });
    const deepReport = deepReportForTest();
    const progressJson = {
      contractSafetyAnalysis: { status: "completed", report: JSON.parse(JSON.stringify(contractReport)) }
    };
    const whereJob = whereIsMoneyJobForTest({
      progressJson,
      resultJson: { subjectAddress: walletAddress, whereIsMoneyReport: whereReport }
    });
    const deepJob = whereIsMoneyJobForTest({
      kind: "address_deep_check",
      progressJson,
      resultJson: persistedDeepResultJsonForTest(deepReport)
    });

    expect(extractSmartContractCheckReportFromJob(whereJob, walletAddress)).toMatchObject({
      subjectAddress: walletAddress,
      verify20Fingerprint: { matched: true }
    });
    const whereFirst = plainTelegramText(formatWhereIsMoneyUserDeliveryReport(
      whereJob,
      whereReport,
      "completed",
      deepJob,
      { locale: "en" }
    ).text);
    const deepFirst = plainTelegramText(formatDeepForensicUserDeliveryReport(
      deepJob,
      deepReport,
      "completed",
      whereJob,
      { locale: "en" }
    ).text);
    const whereFirstRu = plainTelegramText(formatWhereIsMoneyUserDeliveryReport(
      whereJob,
      whereReport,
      "completed",
      deepJob,
      { locale: "ru" }
    ).text);
    expect(whereFirst).toContain("85/100");
    expect(deepFirst).toContain("85/100");
    expect(whereFirst).toContain("Do not proceed");
    expect(deepFirst).toContain("Do not proceed");
    expect(whereFirst).not.toContain("No exact theft");
    expect(whereFirstRu).not.toContain("Точных признаков кражи");
    expect(whereFirst).not.toContain("No exact theft");
    expect(whereFirst).not.toContain("No deterministic bad evidence");
    expect(whereFirstRu).not.toContain("Точных признаков кражи");
    expect(whereFirstRu).not.toContain("Жёстких плохих доказательств");
  });

  it("uses the same saved Fast-only winner in Where-first, Deep-first, and check_status delivery", async () => {
    const fastReport = riskReportForTest({
      level: "CRITICAL",
      score: 90,
      launderingPatternScore: 90,
      dominantRiskType: "laundering_pattern",
      reasons: [{
        code: "address_behavior_high_volume_transit",
        message: "RAW SAVED FAST MESSAGE MUST NOT LEAK",
        scoreImpact: 90,
        evidenceRef: "fast-evidence:saved-high-volume"
      }]
    });
    const whereReport = whereIsMoneyReportForTest({ fastWalletRisk: fastReport });
    const deepReport = freshNarrativeDeepReportForTest();
    const cleanFirstHop = persistedFirstHopEvidenceForTest();
    cleanFirstHop.firstHopBlacklistFacts = [];
    cleanFirstHop.firstHopLabelFacts = [];
    cleanFirstHop.firstHopBlacklistCoverage.confirmedAdverseFactCount = 0;
    cleanFirstHop.firstHopBlacklistCoverage.completeTimelineFactCount = 0;
    const cleanSnapshots = cleanFirstHop.directHardEvidenceSnapshots.map((snapshot) => ({
      ...snapshot,
      labels: [],
      usdtRestriction: {
        ...snapshot.usdtRestriction,
        isBlacklisted: false,
        blacklistEventTxHash: null,
        blacklistEventTimestamp: null,
        blacklistEventBlock: null,
        blacklistTimeline: { events: [], pagination: "complete" as const, failureReason: null }
      },
      hasHardEvidence: false,
      reasons: []
    }));
    const persistedDeep = persistedDeepResultJsonForTest(deepReport);
    persistedDeep.firstHopBlacklistFacts = cleanFirstHop.firstHopBlacklistFacts;
    persistedDeep.firstHopLabelFacts = cleanFirstHop.firstHopLabelFacts;
    persistedDeep.firstHopBlacklistCoverage = cleanFirstHop.firstHopBlacklistCoverage;
    persistedDeep.directHardEvidenceSnapshots = cleanSnapshots;
    const whereJob = whereIsMoneyJobForTest({
      id: "saved-fast-where",
      resultJson: { subjectAddress: walletAddress, whereIsMoneyReport: whereReport }
    });
    const deepJob = whereIsMoneyJobForTest({
      id: "saved-fast-deep",
      kind: "address_deep_check",
      resultJson: persistedDeep
    });

    const whereFirst = plainTelegramText(formatWhereIsMoneyUserDeliveryReport(
      whereJob,
      whereReport,
      "completed",
      deepJob,
      { locale: "ru" }
    ).text);
    const deepFirst = plainTelegramText(formatDeepForensicUserDeliveryReport(
      deepJob,
      deepReport,
      "completed",
      whereJob,
      { locale: "ru" }
    ).text);
    const { bot, calls } = await createSmokeBot({
      defaultLocale: "ru",
      getForensicCheckJob: async () => whereJob,
      getLatestDeepForensicCheckJobForAddressAnyStatus: async () => deepJob
    });
    await bot.handleUpdate(messageUpdate("/check_status saved-fast-where", userId));
    const status = lastPlainText(calls);

    for (const text of [whereFirst, deepFirst, status]) {
      expect(text).toContain("Через кошелёк проходит много входящих и исходящих переводов");
      expect(text).not.toContain("address_behavior_high_volume_transit");
      expect(text).not.toContain("RAW SAVED FAST MESSAGE MUST NOT LEAK");
    }
  });

  it("ignores a mismatched explicit Fast report and falls back only to a subject-bound saved report", () => {
    const saved = riskReportForTest({
      score: 90,
      level: "CRITICAL",
      launderingPatternScore: 90,
      dominantRiskType: "laundering_pattern",
      reasons: [{
        code: "address_behavior_high_volume_transit",
        message: "RAW SUBJECT-BOUND MESSAGE MUST NOT LEAK",
        scoreImpact: 90
      }]
    });
    const mismatched = riskReportForTest({
      subjectAddress: secondWalletAddress,
      score: 100,
      level: "CRITICAL",
      reasons: [{
        code: "stablecoin_usdt_blacklisted",
        message: "RAW MISMATCHED MESSAGE MUST NOT LEAK",
        scoreImpact: 100
      }]
    });
    const fallback = formatUnifiedAddressFinalReportForTest({
      address: walletAddress,
      whereReport: whereIsMoneyReportForTest({ fastWalletRisk: saved }),
      fastReport: mismatched,
      locale: "ru"
    });
    const rejected = formatUnifiedAddressFinalReportForTest({
      address: walletAddress,
      whereReport: whereIsMoneyReportForTest({
        fastWalletRisk: { ...saved, subjectAddress: secondWalletAddress }
      }),
      fastReport: mismatched,
      locale: "ru"
    });

    expect(fallback).toContain("Через кошелёк проходит много входящих и исходящих переводов");
    expect(fallback).not.toContain("чёрном списке USDT");
    expect(rejected).not.toContain("Через кошелёк проходит много входящих и исходящих переводов");
    expect(rejected).not.toContain("чёрном списке USDT");
    expect(`${fallback}\n${rejected}`).not.toContain("RAW MISMATCHED MESSAGE MUST NOT LEAK");
  });

  it("does not reuse Verify20 evidence from an unmarked related Deep job", () => {
    const legacyDeepResult = persistedDeepResultJsonForTest(deepReportForTest());
    delete legacyDeepResult.scoringPolicyVersion;
    const whereReport = whereIsMoneyReportForTest({ riskScore: 25 });
    const whereJob = whereIsMoneyJobForTest({
      progressJson: {},
      resultJson: { subjectAddress: walletAddress, whereIsMoneyReport: whereReport }
    });
    const legacyDeepJob = whereIsMoneyJobForTest({
      kind: "address_deep_check",
      progressJson: {
        contractSafetyAnalysis: {
          status: "completed",
          report: JSON.parse(JSON.stringify(exactVerify20ContractReportForTest()))
        }
      },
      resultJson: legacyDeepResult
    });

    const text = plainTelegramText(formatWhereIsMoneyUserDeliveryReport(
      whereJob,
      whereReport,
      "completed",
      legacyDeepJob,
      { locale: "en" }
    ).text);

    expect(text).not.toContain("85/100");
    expect(text).not.toContain("full Verify20 contract pattern");
  });

  it("does not forge a Verify20 floor from malformed or legacy progress", () => {
    const malformed = JSON.parse(JSON.stringify(exactVerify20ContractReportForTest()));
    malformed.contractProfile.methodMap = {};
    expect(extractSmartContractCheckReportFromJob(whereIsMoneyJobForTest({
      progressJson: { contractSafetyAnalysis: { status: "completed", report: malformed } }
    }), walletAddress)).toBeNull();
    expect(extractSmartContractCheckReportFromJob(whereIsMoneyJobForTest({ progressJson: {} }), walletAddress)).toBeNull();

    const forgedExactDrain = JSON.parse(JSON.stringify(exactVerify20ContractReportForTest()));
    forgedExactDrain.exactDrainProven = true;
    forgedExactDrain.riskScore = 95;
    expect(extractSmartContractCheckReportFromJob(whereIsMoneyJobForTest({
      progressJson: { contractSafetyAnalysis: { status: "completed", report: forgedExactDrain } }
    }), walletAddress)).toBeNull();
  });

  it("extracts validated persisted first-hop evidence without dropping timeline fields", () => {
    const evidence = persistedFirstHopEvidenceForTest();
    const resultJson = {
      ...persistedDeepResultJsonForTest(deepReportForTest()),
      ...evidence
    };
    const report = extractDeepForensicReportFromJob(whereIsMoneyJobForTest({
      kind: "address_deep_check",
      resultJson
    }), walletAddress);

    expect(report?.firstHopBlacklistFacts).toEqual(evidence.firstHopBlacklistFacts);
    expect(report?.firstHopLabelFacts).toEqual(evidence.firstHopLabelFacts);
    expect(report?.firstHopBlacklistCoverage).toEqual(evidence.firstHopBlacklistCoverage);
    expect(report?.directHardEvidenceSnapshots).toEqual(evidence.directHardEvidenceSnapshots.map((snapshot) => ({
      ...snapshot,
      labels: snapshot.labels.map((label) => ({ ...label, createdAt: new Date(label.createdAt) }))
    })));
  });

  it("fails closed atomically when one persisted first-hop fact is malformed", () => {
    const evidence = persistedFirstHopEvidenceForTest();
    const report = extractDeepForensicReportFromJob(whereIsMoneyJobForTest({
      kind: "address_deep_check",
      resultJson: {
        ...persistedDeepResultJsonForTest(deepReportForTest()),
        ...evidence,
        firstHopBlacklistFacts: [...evidence.firstHopBlacklistFacts, { direction: "sideways" }]
      }
    }), walletAddress);

    expect(report).toMatchObject({
      firstHopBlacklistFacts: [],
      firstHopLabelFacts: [],
      directHardEvidenceSnapshots: [],
      firstHopBlacklistCoverage: {
        requiredForDecision: true,
        directPrincipalTransferCoverage: "partial",
        blacklistCheckCoverage: "provider_failed",
        incompleteReason: "persisted_first_hop_evidence_invalid"
      }
    });
  });

  it("keeps first-hop evidence absent for legacy persisted Deep reports", () => {
    const legacyDeep = deepReportForTest();
    delete legacyDeep.firstHopBlacklistFacts;
    delete legacyDeep.firstHopLabelFacts;
    delete legacyDeep.firstHopBlacklistCoverage;
    const report = extractDeepForensicReportFromJob(whereIsMoneyJobForTest({
      kind: "address_deep_check",
      resultJson: persistedDeepResultJsonForTest(legacyDeep)
    }), walletAddress);

    expect(report).not.toBeNull();
    expect(report?.firstHopBlacklistFacts).toBeUndefined();
    expect(report?.firstHopLabelFacts).toBeUndefined();
    expect(report?.firstHopBlacklistCoverage).toBeUndefined();
    expect(report?.directHardEvidenceSnapshots).toBeUndefined();
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

    expectCompactNoFinalNarrative(text);
    const scores = text.match(/\d+\/100/g) ?? [];
    expect(scores).toHaveLength(0);
    expect(text).not.toContain("Behavior warning");
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

    expectCompactNoFinalNarrative(text);
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

    expectCompactNoFinalNarrative(text);
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

    expectCompactNoFinalNarrative(normalText);
    expect(normalText).not.toContain("Blocked reason");
    expect(normalText).not.toContain("Technical status");
    expect(betaText).not.toContain("Blocked reason: insufficient_coverage");
    expect(betaText).not.toContain("Technical status: provider_cap_unresolved");
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

    expectCompactNoFinalNarrative(text);
    expect(text).not.toContain("Decision: DECLINE");
    expectCompactNoFinalNarrative(text);
  });

  function preliminaryDelivery(
    report: WhereIsMoneyReport,
    options: Parameters<typeof formatWhereIsMoneyUserDeliveryReport>[4] = { locale: "ru" },
    overrides: { deepStatus?: ForensicCheckJob["status"]; whereStatus?: "completed" | "partial"; job?: ForensicCheckJob } = {}
  ) {
    const deepJob = whereIsMoneyJobForTest({
      id: "deep-preliminary-pending",
      kind: "address_deep_check",
      status: overrides.deepStatus ?? "running",
      subjectAddress: report.subjectAddress,
      resultJson: {}
    });
    return formatWhereIsMoneyUserDeliveryReport(
      overrides.job ?? whereIsMoneyJobForTest({ progressJson: { locale: "ru" } }),
      report,
      overrides.whereStatus ?? "completed",
      deepJob,
      options
    );
  }

  function preliminaryDeliveryText(
    report: WhereIsMoneyReport,
    options: Parameters<typeof formatWhereIsMoneyUserDeliveryReport>[4] = { locale: "ru" },
    overrides: Parameters<typeof preliminaryDelivery>[2] = {}
  ): string {
    return plainTelegramText(preliminaryDelivery(report, options, overrides).text);
  }

  it.each(["queued", "running"] as const)(
    "renders the approved preliminary narrative for matching %s DeepCheck",
    (deepStatus) => {
      const report = bridgeWhereReportFixture({ score: 78, share: 0.83, transferCount: 10 });
      const text = preliminaryDeliveryText(report, { locale: "ru", runtimeLabel: "worker-test" }, { deepStatus });
      const ordered = [
        "Откуда деньги — предварительный результат",
        "Адрес",
        "Предварительный риск: 🟠 78/100",
        "Что нашли",
        "Вывод"
      ];

      ordered.reduce((previous, heading) => {
        const position = text.indexOf(heading);
        expect(position).toBeGreaterThan(previous);
        return position;
      }, -1);
      expect(text).toContain(report.subjectAddress);
      expect(text).toMatch(/83%.*UsdtOFT.*10 перевод/i);
      expect((plainSectionText(text, "Что нашли").match(/•/g) ?? [])).toHaveLength(1);
      expect(text).not.toContain("Runtime: worker-test");
      expect(text).not.toMatch(/Почему|Что дальше|DeepCheck|Финальный итог|предварительную проверку происхождения/i);
      expect(text).not.toMatch(/Операцию не проводить|Можно принять|hard-proof|transferFrom|ПОИСК|POISON|cross_chain_boundary/i);
      expect(text).not.toContain(POISON_RAW_REASON);
    }
  );

  it("uses the same preliminary contract for a partial Where result with pending DeepCheck", () => {
    const report = bridgeWhereReportFixture();
    report.coverage = {
      ...report.coverage,
      partial: true,
      coverageRatio: 0.83,
      currentBalanceCoverageRatio: 0.83
    };
    const text = preliminaryDeliveryText(
      report,
      { locale: "ru", runtimeLabel: "worker-partial" },
      { whereStatus: "partial" }
    );

    expect(text).toContain("Откуда деньги — предварительный результат");
    expect(text).toContain("Предварительный риск: 🟠 78/100");
    expect(text).toContain("Что нашли");
    expect(text).toContain("Вывод");
    expect(plainSectionText(text, "Границы проверки")).toMatch(/прослежено 83% суммы/i);
    expect(text.indexOf("Границы проверки")).toBeGreaterThan(text.indexOf("Вывод"));
    expect(text).not.toContain("Runtime: worker-partial");
    expect(text).not.toMatch(/DeepCheck|Что дальше|Финальный итог/i);
  });

  it.each([
    [29, "🟢"],
    [30, "🟡"],
    [60, "🟠"],
    [85, "🔴"]
  ] as const)("keeps the preliminary emoji at %s", (score, icon) => {
    expect(preliminaryDeliveryText(bridgeWhereReportFixture({ score })))
      .toContain(`${icon} ${score}/100`);
  });

  it.each([false, undefined])("hides preliminary score when scoreValid=%s", (validity) => {
    const report = bridgeWhereReportFixture({ score: 78, scoreValid: false });
    if (validity === undefined) {
      delete report.scoreValid;
      delete report.assessment.scoreValid;
      delete report.scoringPolicyVersion;
      delete report.assessment.scoringPolicyVersion;
    }
    const diagnostics: unknown[] = [];
    const text = preliminaryDeliveryText(report, {
      locale: "ru",
      onPreliminaryDiagnostic: (diagnostic) => diagnostics.push(diagnostic)
    });

    expect(text).toContain("Предварительный риск не рассчитан");
    expect(text).not.toMatch(/[🟢🟡🟠🔴]|\/100|78/);
    expect(text).not.toContain("Что нашли");
    expect(diagnostics).toEqual([]);
  });

  it("reports one typed diagnostic and hides a valid unexplained score", () => {
    const report = bridgeWhereReportFixture({ score: 78 });
    report.originPaths = [];
    report.assessment.sourcePolicyEvidence = [];
    const diagnostics: unknown[] = [];
    const text = preliminaryDeliveryText(report, {
      locale: "ru",
      onPreliminaryDiagnostic: (diagnostic) => diagnostics.push(diagnostic)
    }, { job: whereIsMoneyJobForTest({ id: "where-unexplained" }) });

    expect(text).toContain("Предварительный риск не рассчитан");
    expect(text).not.toMatch(/[🟢🟡🟠🔴]|\/100|78/);
    expect(diagnostics).toEqual([{
      code: "where_preliminary_score_without_structured_fact",
      jobId: "where-unexplained",
      subjectAddress: report.subjectAddress,
      riskScore: 78
    }]);
  });

  it("keeps preliminary delivery unchanged when the optional diagnostic callback throws", () => {
    const report = bridgeWhereReportFixture({ score: 78 });
    report.originPaths = [];
    report.assessment.sourcePolicyEvidence = [];
    const baseline = preliminaryDelivery(report, { locale: "ru" });
    let callbackCalls = 0;
    let actual: ReturnType<typeof preliminaryDelivery> | undefined;

    expect(() => {
      actual = preliminaryDelivery(report, {
        locale: "ru",
        onPreliminaryDiagnostic: () => {
          callbackCalls += 1;
          throw new Error("raw diagnostic callback failure");
        }
      });
    }).not.toThrow();

    expect(callbackCalls).toBe(1);
    expect(actual).toEqual(baseline);
    expect(actual?.text).toContain("Предварительный риск не рассчитан");
    expect(actual?.text).not.toContain("raw diagnostic callback failure");
  });

  it("prefers the explicit English locale and does not leak Russian headings", () => {
    const text = preliminaryDeliveryText(bridgeWhereReportFixture(), { locale: "en" });

    expect(text).toContain("Where Is Money — preliminary result");
    expect(text).toContain("Preliminary risk: 🟠 78/100");
    expect(text).toContain("Finding");
    expect(text).toContain("Conclusion");
    expect(text).not.toMatch(/Откуда деньги|Адрес|Предварительный|Что нашли|Вывод|Границы/);
  });

  it("escapes a service label once in Telegram HTML", () => {
    const report = sourceWhereReportFixture({
      kind: "cross_chain_boundary",
      score: 78,
      share: 0.83,
      label: "<Bridge & Co>"
    });
    const message = preliminaryDelivery(report);
    const plain = plainTelegramText(message.text);

    expect(plain.match(/<Bridge & Co>/g)).toHaveLength(1);
    expect(message.text.match(/&lt;Bridge &amp; Co&gt;/g)).toHaveLength(1);
    expect(message.text).not.toContain("&amp;lt;");
  });

  it.each([
    ["overlong", "X".repeat(260)],
    ["internal code", "provider_cap_unresolved"],
    ["forbidden heading", "Coverage limits"]
  ])("delivers the bridge score when an unrelated CEX has an unsafe %s label", (_name, label) => {
    const report = bridgeWhereReportFixture({ score: 78, share: 0.83, transferCount: 2 });
    const unrelated = sourceWhereReportFixture({
      kind: "allowlisted_cex", score: 18, share: 0.17, label
    });
    report.originPaths.push(...unrelated.originPaths);

    let message: ReturnType<typeof preliminaryDelivery> | undefined;
    expect(() => {
      message = preliminaryDelivery(report);
    }).not.toThrow();
    const plain = plainTelegramText(message!.text);
    expect(plain).toContain("🟠 78/100");
    expect(plain).toContain("UsdtOFT");
    expect(plain).not.toContain(label);
  });

  it("does not show a coverage-limits section for complete 100% coverage", () => {
    const text = preliminaryDeliveryText(bridgeWhereReportFixture());

    expect(text).not.toContain("Границы проверки");
  });

  it("uses exact Verify20 only from the validated subject-bound Where job", () => {
    const driver = whereRiskLayerFixture("verify20_template", 85, "contract_suspicion", ["verify20:5082dd12"]);
    const report = whereReportFixture({
      subjectAddress: walletAddress,
      riskScore: 85,
      assessment: whereAssessmentFixture({
        riskScore: 85,
        contractSuspicionEvidence: [driver],
        dominantRiskLayer: driver
      })
    });
    const exactJob = whereIsMoneyJobForTest({
      progressJson: {
        locale: "ru",
        contractSafetyAnalysis: {
          status: "completed",
          report: JSON.parse(JSON.stringify(exactVerify20ContractReportForTest()))
        }
      }
    });
    const exact = preliminaryDeliveryText(report, { locale: "ru" }, { job: exactJob });

    expect(exact).toContain("🔴 85/100");
    expect(exact).toMatch(/полный шаблон Verify20/i);

    const malformed = JSON.parse(JSON.stringify(exactVerify20ContractReportForTest()));
    malformed.contractProfile.methodMap = {};
    const malformedText = preliminaryDeliveryText(report, { locale: "ru" }, {
      job: whereIsMoneyJobForTest({
        progressJson: { contractSafetyAnalysis: { status: "completed", report: malformed } }
      })
    });
    const mismatched = JSON.parse(JSON.stringify(exactVerify20ContractReportForTest()));
    mismatched.subjectAddress = secondWalletAddress;
    const mismatchedText = preliminaryDeliveryText(report, { locale: "ru" }, {
      job: whereIsMoneyJobForTest({
        progressJson: { contractSafetyAnalysis: { status: "completed", report: mismatched } }
      })
    });

    for (const text of [malformedText, mismatchedText]) {
      expect(text).toContain("Предварительный риск не рассчитан");
      expect(text).not.toMatch(/Verify20|\/100/);
    }
  });

  it("does not reuse Deep-only Verify20 evidence for preliminary Where", () => {
    const driver = whereRiskLayerFixture("verify20_template", 85, "contract_suspicion", ["verify20:5082dd12"]);
    const report = whereReportFixture({
      riskScore: 85,
      assessment: whereAssessmentFixture({
        riskScore: 85,
        contractSuspicionEvidence: [driver],
        dominantRiskLayer: driver
      })
    });
    const deepJob = whereIsMoneyJobForTest({
      id: "deep-only-verify20",
      kind: "address_deep_check",
      status: "running",
      subjectAddress: report.subjectAddress,
      progressJson: {
        contractSafetyAnalysis: {
          status: "completed",
          report: JSON.parse(JSON.stringify(exactVerify20ContractReportForTest()))
        }
      }
    });
    const message = formatWhereIsMoneyUserDeliveryReport(
      whereIsMoneyJobForTest(), report, "completed", deepJob, { locale: "ru" }
    );
    const text = plainTelegramText(message.text);

    expect(text).toContain("Предварительный риск не рассчитан");
    expect(text).not.toMatch(/Verify20|\/100/);
  });

  it.each([
    { name: "failed", status: "failed", subjectAddress: walletAddress },
    { name: "running subject-mismatched", status: "running", subjectAddress: secondWalletAddress },
    { name: "completed subject-mismatched", status: "completed", subjectAddress: secondWalletAddress }
  ] as const)(
    "keeps the standalone Where route for $name DeepCheck",
    ({ status, subjectAddress }) => {
      const report = bridgeWhereReportFixture();
      const deepJob = whereIsMoneyJobForTest({
        kind: "address_deep_check",
        status,
        subjectAddress
      });
      const text = plainTelegramText(formatWhereIsMoneyUserDeliveryReport(
        whereIsMoneyJobForTest(), report, "completed", deepJob, { locale: "ru" }
      ).text);

      expect(text).not.toContain("предварительный результат");
      expectCompactNoFinalNarrative(text);
      expect(text).toMatch(/⚪ Итоговая оценка не рассчитана/u);
    }
  );

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

    expectCompactNoFinalNarrative(text);
    expect(text).not.toContain("0/100");
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

    expectCompactScoredNarrative(text, 95);
    expect(text).not.toContain("Решение: DECLINE");
    expect(text).toContain("95/100");
    expect(text).not.toContain("Решение: DECLINE");
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

    expectCompactScoredNarrative(text, 80);
    expect(text).toContain("Pause the operation");
    expect(text.match(/\d+\/100/g)).toEqual(["80/100"]);
    expect(text).not.toContain("Route-linked approval-drain context found without exact approval-drain proof.");
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

    expectCompactScoredNarrative(text, 95);
    expect(text).toContain("Do not proceed");
    expect(text).not.toContain("(Final risk: )");
    expect(text.match(/\d+\/100/g)).toEqual(["95/100"]);
    expect(text).not.toContain("Exact approval-drain evidence was found");
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

    expectCompactScoredNarrative(text, 85);
    expect(text).toContain("Do not proceed");
    expect(text.match(/\d+\/100/g)).toEqual(["85/100"]);
    expect(text).not.toContain("Deep Research found deterministic high-risk inbound provenance");
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

    expectCompactScoredNarrative(text, 85);
    expect(text).toContain("Do not proceed");
    expect(text.match(/\d+\/100/g)).toEqual(["85/100"]);
    expect(text).not.toContain("Deep Research found exact high-risk extended provenance");
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

    expectCompactScoredNarrative(text, 70);
    expect(text).toContain("Do not proceed");
    expect(text.match(/\d+\/100/g)).toEqual(["70/100"]);
    expect(text).not.toContain("DeepCheck found a source-policy link to whitebit. This does not prove theft, but requires source-of-funds review.");
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

    expectCompactNoFinalNarrative(plainTelegramText(message.text));
    expect(message.text).not.toContain("готово, есть ограничения");
    expect(message.text).not.toContain("частично");
    expect(message.text).not.toContain("DeepCheck");
    expect(message.text).not.toContain("Data quality");
    expect(message.text).not.toContain("Технические детали");
    expect(message.text).not.toContain("Job:");
    expect(message.text).not.toContain("60/100");
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
        scoringPolicyVersion: SCORING_SIGNAL_MATRIX_POLICY_VERSION,
        scoreValid: true,
        scoreBlockedReason: null,
        technicalStatus: "completed",
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
          scoreValid: true,
          scoreBlockedReason: null,
          technicalStatus: "completed",
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

    expectCompactNoFinalNarrative(text);
    expect(text).not.toContain("Exact approval-drain evidence was found");
    expect(text).not.toContain("Deterministic high-risk provenance evidence was found.");
    expect(text).not.toContain("Previous fast risk");
    expect(text).not.toContain("95/100");
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
        scoringPolicyVersion: SCORING_SIGNAL_MATRIX_POLICY_VERSION,
        scoreValid: true,
        scoreBlockedReason: null,
        technicalStatus: "completed",
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
          scoreValid: true,
          scoreBlockedReason: null,
          technicalStatus: "completed",
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

    expectCompactNoFinalNarrative(text);
    expect(text).not.toContain("Source-policy evidence reached the decline or manual-review threshold.");
    expect(text).not.toContain("No deterministic bad evidence was found.");
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

    expectCompactNoFinalNarrative(text);
    expect(text).not.toContain("Cross-chain corridor");
    expect(text).not.toContain("no-name token liquidity");
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

    expectCompactNoFinalNarrative(text);
    expect(text).not.toContain("Stage 2 was triggered, but provider data is partial");
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

    expectCompactNoFinalNarrative(text);
    expect(text).not.toContain("Bridge continuation");
    expect(text).not.toContain("candidate-only");
    expect(text).not.toContain("0xcandidate");
    expect(text).not.toContain("Continuation reasoning");
    expect(text).not.toContain("Switch continuation provider");
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

    expectCompactNoFinalNarrative(text);
    expect(text).not.toContain("Deep cross-chain analysis was not auto-run below threshold");
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

    expectCompactNoFinalNarrative(text);
    expect(text).not.toContain("Deep cross-chain analysis was not auto-run");
    expect(text).not.toContain("not auto-run below threshold");
  });

  it("does not label data-exhausted Stage 2 coverage as source-policy risk", () => {
    const text = plainTelegramText(formatWhereIsMoneyReport(
      whereIsMoneyJobForTest(),
      stage2WhereReportForTest("data_exhausted"),
      "partial",
      { locale: "en" }
    ).text);

    expectCompactNoFinalNarrative(text);
    expect(text).not.toContain("Terminal boundary: data exhausted");
    expect(text).not.toContain("insufficient_coverage; provider coverage is incomplete");
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

    expectCompactNoFinalNarrative(text);
    expect(text).not.toContain("Top path");
    expect(text).not.toContain("tx-bridge-stage2");
    expect(text).not.toContain("tx-terminal-stage2");
    expect(text).not.toContain("tx-second-path-should-not-render");
  });

  it("uses hard-proof wording only for exact sanctioned Stage 2 evidence", () => {
    const text = plainTelegramText(formatWhereIsMoneyReport(
      whereIsMoneyJobForTest(),
      stage2WhereReportForTest("sanctioned_service"),
      "completed",
      { locale: "en" }
    ).text);

    expectCompactNoFinalNarrative(text);
    expect(text).not.toContain("Cross-chain corridor");
    expect(text).not.toContain("Exact sanctioned service evidence found in cross-chain corridor.");
    expect(text).not.toContain("hard proof");
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

    expectCompactScoredNarrative(text, 70);
    expect(text).toContain("Do not proceed");
    expect(text).not.toContain("Source-policy evidence reached the decline or manual-review threshold.");
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

    expectCompactScoredNarrative(text, 29);
    expect(text).toContain("You can proceed");
    expect(text).toContain("low risk");
    expect(text).not.toContain("No deterministic bad evidence was found.");
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

    expectCompactNoFinalNarrative(text);
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

    expectCompactNoFinalNarrative(text);
    expect(text).not.toContain("Final risk: 45");
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

    expectCompactNoFinalNarrative(finalText);
    expect(finalText).not.toContain("residual source-provenance gaps remain below materiality");
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

    expectCompactNoFinalNarrative(finalText);
    expect(finalText).not.toContain("Small dense-hop source tail remains unresolved");
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

    expectCompactNoFinalNarrative(finalText);
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
        scoringPolicyVersion: SCORING_SIGNAL_MATRIX_POLICY_VERSION,
        scoreValid: true,
        scoreBlockedReason: null,
        technicalStatus: "completed",
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
          scoreValid: true,
          scoreBlockedReason: null,
          technicalStatus: "completed",
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

    expectCompactNoFinalNarrative(text);
    expect(text).not.toContain("Deterministic high-risk provenance evidence was found.");
    expect(text).not.toContain("AI contract verdict");
    expect(text).not.toContain("drainer_like");
    expect(text).not.toContain("Wrapper method hides token movement.");
    expect(text).not.toContain("Context evidence");
    expect(text).not.toContain("normalized contribution");
    expect(text).not.toContain("Evidence type");
    expect(text).not.toContain("Hard evidence: AI contract verdict");
    expect(text).not.toContain("AI verdict is advisory; final exchange decision is policy-owned.");
    expect(text).not.toContain("59/100");
    expect(text).not.toContain("Matrix row: contract_suspicion; matrix decision: REVIEW.");
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
    expect(text).not.toContain("Runtime: worker-a");
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

  it("returns /check before slow work and handles a later callback exactly once", async () => {
    const signals = createDeferred<any>();
    const { bot, calls } = await createSmokeBot({ addressRiskSignals: () => signals.promise });

    const checkUpdate = bot.handleUpdate(messageUpdate(`/check ${walletAddress}`, userId));

    expect(await settlesThisTurn([checkUpdate])).toBe(true);
    expect(messageCalls(calls).filter((call) => plainTelegramText(String(call.payload.text)).includes("Address check started"))).toHaveLength(1);

    const callbackUpdate = bot.handleUpdate(callbackQueryUpdate("home", userId));
    expect(await settlesThisTurn([callbackUpdate])).toBe(true);
    expect(calls.some((call) => call.method === "answerCallbackQuery")).toBe(true);

    signals.resolve({ graphSignals: [], behaviorSignals: [], amlSignals: [] });
    await waitForCondition(() => messageCalls(calls).some((call) => plainTelegramText(String(call.payload.text)).includes(`Address: ${walletAddress}`)));
    expect(messageCalls(calls).filter((call) => plainTelegramText(String(call.payload.text)).includes(`Address: ${walletAddress}`))).toHaveLength(1);
  });

  it("keeps topic, direct-message, and business routing on a detached check result", async () => {
    const signals = createDeferred<any>();
    const { bot, calls } = await createSmokeBot({ addressRiskSignals: () => signals.promise });

    await bot.handleUpdate(routedMessageUpdate(`/check ${walletAddress}`, userId));
    signals.resolve({ graphSignals: [], behaviorSignals: [], amlSignals: [] });
    await waitForCondition(() => messageCalls(calls).some((call) => plainTelegramText(String(call.payload.text)).includes(`Address: ${walletAddress}`)));

    const results = messageCalls(calls).filter((call) => plainTelegramText(String(call.payload.text)).includes(`Address: ${walletAddress}`));
    expect(results).toHaveLength(1);
    expect(results[0]?.payload).toMatchObject({
      message_thread_id: 701,
      direct_messages_topic_id: 702,
      business_connection_id: "business-703"
    });
  });

  it("keeps topic, direct-message, and business routing on a detached check failure", async () => {
    const signals = createDeferred<any>();
    const { bot, calls } = await createSmokeBot({ addressRiskSignals: () => signals.promise });

    await bot.handleUpdate(routedMessageUpdate(`/check ${walletAddress}`, userId));
    signals.reject(new Error("provider unavailable"));
    await waitForCondition(() => messageCalls(calls).some((call) => plainTelegramText(String(call.payload.text)).includes("Check did not finish")));

    const failures = messageCalls(calls).filter((call) => plainTelegramText(String(call.payload.text)).includes("Check did not finish"));
    expect(failures).toHaveLength(1);
    expect(failures[0]?.payload).toMatchObject({
      message_thread_id: 701,
      direct_messages_topic_id: 702,
      business_connection_id: "business-703"
    });
  });

  it("logs only stable diagnostics when detached check work and failure delivery reject", async () => {
    const workSecret = "work-secret-chat-text-markup-token";
    const deliverySecret = "delivery-secret-chat-text-markup-token";
    const workError = grammyErrorWithSecret(429, workSecret);
    const deliveryError = grammyErrorWithSecret(403, deliverySecret);
    const signals = createDeferred<any>();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const { bot } = await createSmokeBot({
        addressRiskSignals: () => signals.promise,
        beforeApiResult: async (method, payload) => {
          if (method === "sendMessage" && String(payload.text).includes("Check did not finish")) {
            throw deliveryError;
          }
        }
      });

      await bot.handleUpdate(messageUpdate(`/check ${walletAddress}`, userId));
      signals.reject(workError);
      await waitForCondition(() => consoleError.mock.calls.length === 2);

      expect(consoleError.mock.calls).toEqual([
        ["Pending manual check failed", "telegram_error_429"],
        ["Pending manual check failure delivery failed", "telegram_error_403"]
      ]);
      expect(consoleError.mock.calls.flat()).not.toContain(workError);
      expect(consoleError.mock.calls.flat()).not.toContain(deliveryError);
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain(workSecret);
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain(deliverySecret);
    } finally {
      consoleError.mockRestore();
    }
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
    expect(messageCalls(calls).some((call) => plainTelegramText(String(call.payload.text)).includes("Monitoring: active"))).toBe(true);
    expect(lastText(calls)).toContain("Wallet analytics");
    expect(lastPlainText(calls)).toContain("Transfers: 2");
  });

  it("shows loading while sharing same-wallet refresh work and isolating other wallets", async () => {
    const baseClient = createTronClient();
    const firstRefresh = createDeferred<Awaited<ReturnType<TronDashboardClient["getAccount"]>>>();
    const secondRefresh = createDeferred<Awaited<ReturnType<TronDashboardClient["getAccount"]>>>();
    const providerCalls: string[] = [];
    let refreshMode = false;
    const tronClient: TronDashboardClient = {
      ...baseClient,
      async getAccount(address) {
        providerCalls.push(address);
        if (!refreshMode) return baseClient.getAccount(address);
        return address === walletAddress ? firstRefresh.promise : secondRefresh.promise;
      }
    };
    const { bot, calls } = await createSmokeBot({ tronClient });

    await bot.handleUpdate(messageUpdate(`/add_wallet ${walletAddress}`, userId));
    const firstCallback = findCallbackData(lastMessagePayload(calls), "wl:refresh:");
    await bot.handleUpdate(messageUpdate(`/add_wallet ${secondWalletAddress}`, userId));
    const secondCallback = findCallbackData(lastMessagePayload(calls), "wl:refresh:");
    refreshMode = true;

    const sameWalletUpdates = [
      bot.handleUpdate(callbackQueryUpdate(firstCallback, userId)),
      bot.handleUpdate(callbackQueryUpdate(firstCallback, userId))
    ];
    expect(await settlesThisTurn(sameWalletUpdates)).toBe(true);
    expect(providerCalls.filter((address) => address === walletAddress)).toHaveLength(2);
    expect(messageCalls(calls).map((call) => plainTelegramText(String(call.payload.text))).join("\n")).toMatch(/refreshing/i);

    const otherWalletUpdate = bot.handleUpdate(callbackQueryUpdate(secondCallback, userId));
    expect(await settlesThisTurn([otherWalletUpdate])).toBe(true);
    expect(providerCalls.filter((address) => address === secondWalletAddress)).toHaveLength(2);

    firstRefresh.resolve(await baseClient.getAccount(walletAddress));
    secondRefresh.resolve(await baseClient.getAccount(secondWalletAddress));
    await new Promise((resolve) => setImmediate(resolve));

    refreshMode = false;
    expect(await settlesThisTurn([bot.handleUpdate(callbackQueryUpdate(firstCallback, userId))])).toBe(true);
    expect(providerCalls.filter((address) => address === walletAddress)).toHaveLength(3);
  });

  it("does not let a delayed wallet refresh overwrite a newer callback on the same message", async () => {
    const baseClient = createTronClient();
    const refresh = createDeferred<Awaited<ReturnType<TronDashboardClient["getAccount"]>>>();
    let refreshMode = false;
    const tronClient: TronDashboardClient = {
      ...baseClient,
      getAccount: (address) => refreshMode ? refresh.promise : baseClient.getAccount(address)
    };
    const { bot, calls } = await createSmokeBot({ tronClient });

    await bot.handleUpdate(messageUpdate(`/add_wallet ${walletAddress}`, userId));
    const refreshCallback = findCallbackData(lastMessagePayload(calls), "wl:refresh:");
    refreshMode = true;
    expect(await settlesThisTurn([bot.handleUpdate(callbackQueryUpdate(refreshCallback, userId))])).toBe(true);
    expect(lastPlainText(calls)).toMatch(/refreshing wallet data/i);

    await bot.handleUpdate(callbackQueryUpdate("home", userId));
    const newerText = lastText(calls);
    const messageCountAfterNavigation = messageCalls(calls).length;
    expect(plainTelegramText(newerText)).toContain("Watched wallets: 1");

    refresh.resolve(await baseClient.getAccount(walletAddress));
    await new Promise((resolve) => setImmediate(resolve));

    expect(messageCalls(calls)).toHaveLength(messageCountAfterNavigation);
    expect(lastText(calls)).toBe(newerText);
  });

  it("logs only a stable diagnostic when wallet background refresh rejects", async () => {
    const secret = "wallet-refresh-secret-chat-text-markup-token";
    const refreshError = grammyErrorWithSecret(502, secret);
    const baseDb = createFakeDb();
    let rejectRefresh = false;
    const db = {
      connect: () => baseDb.connect(),
      query: (sql: string, params?: unknown[]) => {
        if (rejectRefresh && sql.includes("from wallet_dashboard_snapshots")) return Promise.reject(refreshError);
        return baseDb.query(sql, params);
      }
    } as Db;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const { bot, calls } = await createSmokeBot({ db });
      await bot.handleUpdate(messageUpdate(`/add_wallet ${walletAddress}`, userId));
      const refreshCallback = findCallbackData(lastMessagePayload(calls), "wl:refresh:");
      await new Promise((resolve) => setImmediate(resolve));
      rejectRefresh = true;

      await bot.handleUpdate(callbackQueryUpdate(refreshCallback, userId));
      await waitForCondition(() => consoleError.mock.calls.length === 1);

      expect(consoleError.mock.calls).toEqual([
        ["Wallet dashboard background refresh failed", "telegram_error_502"]
      ]);
      expect(consoleError.mock.calls.flat()).not.toContain(refreshError);
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain(secret);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("logs only a stable diagnostic when wallet background render rejects", async () => {
    const secret = "wallet-render-secret-chat-text-markup-token";
    const renderError = grammyErrorWithSecret(400, secret);
    let rejectDashboardRender = false;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const { bot, calls } = await createSmokeBot({
        beforeApiResult: async (method, payload) => {
          if (rejectDashboardRender && method === "editMessageText" && String(payload.text).includes("Wallet dashboard")) {
            throw renderError;
          }
        }
      });
      await bot.handleUpdate(messageUpdate(`/add_wallet ${walletAddress}`, userId));
      const refreshCallback = findCallbackData(lastMessagePayload(calls), "wl:refresh:");
      rejectDashboardRender = true;

      await bot.handleUpdate(callbackQueryUpdate(refreshCallback, userId));
      await waitForCondition(() => consoleError.mock.calls.length === 1);

      expect(consoleError.mock.calls).toEqual([
        ["Wallet dashboard background refresh failed", "telegram_error_400"]
      ]);
      expect(consoleError.mock.calls.flat()).not.toContain(renderError);
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain(secret);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("does not enter the wallet render barrier for Address Poisoning callbacks", async () => {
    const baseClient = createTronClient();
    const refresh = createDeferred<Awaited<ReturnType<TronDashboardClient["getAccount"]>>>();
    const oldEditStarted = createDeferred<void>();
    const releaseOldEdit = createDeferred<void>();
    let refreshMode = false;
    let holdOldDashboardEdit = false;
    let resolverCalls = 0;
    const tronClient: TronDashboardClient = {
      ...baseClient,
      getAccount: (address) => refreshMode ? refresh.promise : baseClient.getAccount(address)
    };
    const { bot, calls } = await createSmokeBot({
      tronClient,
      resolveAddressPoisoningCandidate: async () => {
        resolverCalls += 1;
        return { outcome: "updated", candidate: poisoningCandidate({ status: "confirmed" }) };
      },
      beforeApiResult: async (method, payload) => {
        if (holdOldDashboardEdit && method === "editMessageText" && String(payload.text).includes("Wallet dashboard")) {
          holdOldDashboardEdit = false;
          oldEditStarted.resolve();
          await releaseOldEdit.promise;
        }
      }
    });

    try {
      await bot.handleUpdate(messageUpdate(`/add_wallet ${walletAddress}`, userId));
      const refreshCallback = findCallbackData(lastMessagePayload(calls), "wl:refresh:");
      refreshMode = true;
      await bot.handleUpdate(callbackQueryUpdate(refreshCallback, userId));

      holdOldDashboardEdit = true;
      refresh.resolve(await baseClient.getAccount(walletAddress));
      await oldEditStarted.promise;

      const poisoningUpdate = bot.handleUpdate(callbackQueryUpdate(`poison:confirm:${poisoningCallbackToken}`, userId));
      expect(await settlesThisTurn([poisoningUpdate])).toBe(true);
      expect(resolverCalls).toBe(1);
    } finally {
      releaseOldEdit.resolve();
    }
  });

  it("settles an already-dispatched old wallet edit before sending a newer callback edit", async () => {
    const baseClient = createTronClient();
    const refresh = createDeferred<Awaited<ReturnType<TronDashboardClient["getAccount"]>>>();
    const oldEditStarted = createDeferred<void>();
    const releaseOldEdit = createDeferred<void>();
    let refreshMode = false;
    let holdOldDashboardEdit = false;
    const tronClient: TronDashboardClient = {
      ...baseClient,
      getAccount: (address) => refreshMode ? refresh.promise : baseClient.getAccount(address)
    };
    const { bot, calls } = await createSmokeBot({
      tronClient,
      beforeApiResult: async (method, payload) => {
        if (holdOldDashboardEdit && method === "editMessageText" && String(payload.text).includes("📍 Wallet dashboard")) {
          holdOldDashboardEdit = false;
          oldEditStarted.resolve();
          await releaseOldEdit.promise;
        }
      }
    });

    await bot.handleUpdate(messageUpdate(`/add_wallet ${walletAddress}`, userId));
    const refreshCallback = findCallbackData(lastMessagePayload(calls), "wl:refresh:");
    refreshMode = true;
    expect(await settlesThisTurn([bot.handleUpdate(callbackQueryUpdate(refreshCallback, userId))])).toBe(true);

    holdOldDashboardEdit = true;
    refresh.resolve(await baseClient.getAccount(walletAddress));
    await oldEditStarted.promise;

    const homeUpdate = bot.handleUpdate(callbackQueryUpdate("home", userId));
    expect(await settlesThisTurn([homeUpdate])).toBe(false);
    expect(messageCalls(calls).some((call) => plainTelegramText(String(call.payload.text)).includes("Watched wallets: 1"))).toBe(false);

    releaseOldEdit.resolve();
    await homeUpdate;

    expect(lastPlainText(calls)).toContain("Watched wallets: 1");
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

  describe("compact wallet narrative integration", () => {
    it("keeps legacy TGyt at 78 and publishes the exact fresh v2 blacklist result at 90", () => {
      const value = TGYT_DIRECT_BLACKLIST_CASE;
      const bridgePolicy = tgytBridgePolicyEvidence();
      const whereReport = whereIsMoneyReportForTest({
        subjectAddress: value.subjectAddress,
        decision: "REVIEW",
        userDecision: "REVIEW",
        internalDecision: "REVIEW",
        proofLevel: "exchange_policy_decline",
        riskScore: 78,
        decisionReasons: [],
        originPaths: [tgytBridgePath()],
        assessment: {
          ...whereAssessmentForTest({ decision: "REVIEW", riskScore: 78 }),
          sourcePolicyEvidence: [bridgePolicy]
        },
        coverage: {
          selectedInboundTxCount: 1,
          targetAmountRaw: value.totalPrincipalRaw,
          selectedAmountRaw: value.totalPrincipalRaw,
          selectedInboundVolumeRaw: value.totalPrincipalRaw,
          coverageRatio: 1,
          currentBalanceCoverageRatio: 1,
          maxDepth: 7,
          fetchedAddressCount: 3,
          partial: false,
          notes: []
        }
      });
      const deepReport = freshNarrativeDeepReportForTest({
        subjectAddress: value.subjectAddress,
        stablecoinRestrictionProfiles: [tgytSubjectRestriction()],
        firstHopBlacklistFacts: [tgytFirstHopBlacklistFact()],
        firstHopBlacklistCoverage: tgytFirstHopCoverage(),
        directCounterpartyInteractionProfiles: tgytDirectInteractionProfiles()
      });
      const fresh = formatUnifiedAddressFinalReportForTest({
        address: value.subjectAddress,
        whereReport,
        deepReport,
        locale: "ru"
      });
      const legacyWhere = {
        ...whereReport,
        scoringPolicyVersion: "scoring-signal-matrix-v1"
      } as unknown as WhereIsMoneyReport;
      const legacy = formatUnifiedAddressFinalReportForTest({
        address: value.subjectAddress,
        whereReport: legacyWhere,
        deepReport,
        locale: "ru"
      });

      expect(fresh).toMatch(/^🔴 90\/100 — критический риск\. Операцию не проводить\./u);
      expect(fresh).toContain("1 176 317 USDT");
      expect(fresh).toContain("TWGC…TdTm");
      expect(fresh).toContain("100% исходящей суммы");
      expect(fresh).toContain("Контрагент в чёрном списке USDT");
      expect(fresh).toMatch(/2 ч 52 мин.*1 176 302 USDT/u);
      expect(fresh).toContain("Сам адрес не в списке");
      expect(fresh).toContain("UsdtOFT");
      expect(fresh).not.toContain("Границы проверки");
      expect(fresh).toMatch(/GasFree|Техническая деталь/u);
      expect(fresh).not.toMatch(/45 с|1 176 320|risky_counterparty|cross_chain_boundary/u);

      expect(legacy).toContain("78/100");
      expect(legacy).toMatch(/устаревш|свеж/u);
      expect(legacy).not.toContain("90/100");
      expect(legacy).not.toContain("TWGC…TdTm");
      expect(legacy).not.toContain("2 ч 52 мин");
    });

    it("uses compact RU and EN scored finals for canonical subject and direct-counterparty blacklist facts", () => {
      const firstHop = persistedFirstHopEvidenceForTest();
      const directFact = firstHop.firstHopBlacklistFacts[0];
      const directDeep = freshNarrativeDeepReportForTest({
        firstHopBlacklistFacts: firstHop.firstHopBlacklistFacts,
        firstHopLabelFacts: firstHop.firstHopLabelFacts,
        firstHopBlacklistCoverage: firstHop.firstHopBlacklistCoverage,
        directCounterpartyInteractionProfiles: [{
          subjectAddress: walletAddress,
          direction: directFact.direction,
          counterpartyAddress: directFact.counterpartyAddress,
          volumeRaw: directFact.principalAmountRaw,
          volumeRatio: 0.75,
          txCount: 1,
          firstSeen: "2026-05-10T01:00:00.000Z",
          lastSeen: "2026-05-10T01:00:00.000Z",
          txHashes: directFact.transferTxHashes,
          transfers: [{
            txHash: directFact.transferTxHashes[0],
            fromAddress: directFact.counterpartyAddress,
            toAddress: walletAddress,
            amountRaw: directFact.principalAmountRaw,
            timestamp: "2026-05-10T01:00:00.000Z",
            method: "transfer",
            edgeType: "normal_transfer"
          }],
          serviceCategory: null,
          identity: null,
          snapshot: {
            address: directFact.counterpartyAddress,
            riskScore: 95,
            riskLevel: "CRITICAL",
            source: "stablecoin_blacklist",
            evidenceClass: "exact_labeled_counterparty",
            reasons: [],
            partialNotes: []
          },
          interactionWeight: 0.95,
          scoreContribution: 88,
          evidenceClass: "exact_labeled_counterparty",
          skippedReason: null
        }]
      });
      const subjectDeep = freshNarrativeDeepReportForTest({
        stablecoinRestrictionProfiles: [stablecoinRestrictionProfile({ subjectAddress: walletAddress })]
      });

      const ru = formatUnifiedAddressFinalReportForTest({
        address: walletAddress,
        whereReport: whereIsMoneyReportForTest(),
        deepReport: directDeep,
        locale: "ru"
      });
      const en = formatUnifiedAddressFinalReportForTest({
        address: walletAddress,
        whereReport: whereIsMoneyReportForTest(),
        deepReport: subjectDeep,
        locale: "en"
      });

      expect(ru).toMatch(/^[🟢🟡🟠🔴] \d+\/100 —/u);
      expect(ru).toMatch(/Входящий:.*10 000 USDT/u);
      expect(ru).toContain("чёрном списке USDT");
      expect(en).toMatch(/^[🟢🟡🟠🔴] \d+\/100 —/u);
      expect(en).toContain("The address is on the USDT blacklist");
      for (const oldHeading of ["Почему", "Что это может значить", "Что делать", "Что важно учесть"]) {
        expect(ru).not.toContain(oldHeading);
      }
      expect(ru.length).toBeLessThanOrEqual(650);
    });

    it("uses canonical approval-drain and bridge evidence without raw reasons", () => {
      const approval = {
        victimAddress: "TVictim111111111111111111111111111111",
        approvalTxHash: "tx-approval",
        drainTxHash: "tx-drain",
        spenderAddress: "TSpender11111111111111111111111111111",
        firstReceiverAddress: walletAddress,
        subjectAddress: walletAddress,
        hopDepth: 0 as const,
        amountRaw: "309000000000",
        amountPreservationRatio: 0.99,
        approvalAt: "2026-05-20T09:50:00.000Z",
        drainAt: "2026-05-20T10:00:00.000Z",
        pathTxHashes: ["tx-drain"],
        pathAddresses: ["TVictim111111111111111111111111111111", walletAddress],
        score: 95,
        evidenceStrength: "exact_approval_and_transfer_from" as const,
        subjectTokenState: null,
        victimTokenState: null,
        features: []
      };
      const approvalText = formatUnifiedAddressFinalReportForTest({
        address: walletAddress,
        whereReport: whereIsMoneyReportForTest(),
        deepReport: freshNarrativeDeepReportForTest({ approvalDrainProvenanceProfiles: [approval] }),
        locale: "ru"
      });
      const bridgePath = {
        balanceTransferTxHash: "tx-bridge",
        rootSourceAddress: "TBridge11111111111111111111111111111",
        rootSourceType: "decline_boundary" as const,
        balanceShare: 0.83,
        exposureSourceLabel: "UsdtOFT",
        sourceExposureKind: "cross_chain_boundary" as const,
        pathAddresses: ["TBridge11111111111111111111111111111", walletAddress],
        txHashes: ["tx-bridge"],
        steps: [{
          txHash: "tx-bridge",
          fromAddress: "TBridge11111111111111111111111111111",
          toAddress: walletAddress,
          amountRaw: "83000000000",
          timestamp: "2026-05-20T10:00:00.000Z"
        }],
        amountUsage: null,
        amountPreservationRatio: 1,
        timeSpanMs: 0,
        stoppedReason: "service_boundary" as const,
        verdict: "REVIEW" as const,
        riskScoreContribution: 58,
        reasons: ["raw_bridge_reason_must_not_leak"]
      };
      const bridgeText = formatUnifiedAddressFinalReportForTest({
        address: walletAddress,
        whereReport: whereIsMoneyReportForTest({ originPaths: [bridgePath] }),
        deepReport: freshNarrativeDeepReportForTest(),
        locale: "ru"
      });

      expect(approvalText).toContain("первым получил 309 000 USDT");
      expect(approvalText).toContain("подтверждённой дрейнер-цепочке");
      expect(bridgeText).toContain("83 000 USDT (83%) пришло через мост UsdtOFT");
      expect(bridgeText).toContain("затруднить проверку происхождения");
      expect(bridgeText).not.toContain("raw_bridge_reason_must_not_leak");
    });

    it("publishes compact NO_FINAL without a score when fresh Deep first-hop evidence is missing or mismatched", () => {
      const missing = formatUnifiedAddressFinalReportForTest({
        address: walletAddress,
        whereReport: whereIsMoneyReportForTest(),
        deepReport: null,
        locale: "ru"
      });
      const mismatched = formatUnifiedAddressFinalReportForTest({
        address: walletAddress,
        whereReport: whereIsMoneyReportForTest(),
        deepReport: freshNarrativeDeepReportForTest({ subjectAddress: secondWalletAddress }),
        locale: "en"
      });

      expect(missing).toMatch(/^⚪ Итог не рассчитан/u);
      expect(missing).toContain("DeepCheck");
      expect(missing).toContain("повтор");
      expect(missing).not.toMatch(/\d+\/100/);
      expect(mismatched).toMatch(/^⚪ No final result/u);
      expect(mismatched).toContain("fresh check");
      expect(mismatched).not.toMatch(/\d+\/100/);
    });

    it("keeps detailed diagnostics but suppresses its final score when current Deep prerequisites are missing", () => {
      const detailed = formatUnifiedAddressDetailedReportForTest({
        address: walletAddress,
        whereReport: whereIsMoneyReportForTest(),
        deepReport: null,
        fastReport: riskReportForTest({
          score: 90,
          level: "CRITICAL",
          reasons: [{
            code: "forensic_address_behavior",
            message: "Address shows high-volume transit-like behavior.",
            scoreImpact: 90
          }]
        }),
        locale: "en"
      });

      expect(detailed).toContain("Detailed address report");
      expect(detailed).toContain("Decision: NO_FINAL_DECISION.");
      expect(detailed).toContain("FastCheck");
      expect(detailed).toContain("Where Is Money");
      expect(detailed).toContain("DeepCheck");
      expect(detailed).toContain("fresh DeepCheck");
      expect(detailed).not.toMatch(/\d+\/100/);
    });

    it("escapes a 271-character narrative text without truncating its tail", () => {
      const escapeNarrative = (createBotModule as typeof createBotModule & {
        escapePlainTelegramText?: (value: string) => string;
      }).escapePlainTelegramText;
      expect(escapeNarrative).toBeTypeOf("function");
      const hostile = `<tag title="x">&'${"a".repeat(250)}TAIL`;
      expect(hostile).toHaveLength(271);

      const escaped = escapeNarrative!(hostile);

      expect(escaped).toContain("&lt;tag title=&quot;x&quot;&gt;&amp;&#39;");
      expect(escaped).not.toContain("<tag");
      expect(escaped).not.toContain("...");
      expect(escaped.endsWith("TAIL")).toBe(true);
    });

    it("keeps normal HTML safe and exposes diagnostics only on explicit beta output", () => {
      const deepReport = freshNarrativeDeepReportForTest({
        boundaryExposureProfiles: [boundaryExposureProfile({
          topBoundaryEntities: [{
            address: "TService11111111111111111111111111111",
            category: "bridge_pool",
            identity: "<b>hostile & service</b>",
            direction: "outbound",
            volumeRaw: "311851000000",
            txCount: 4,
            maxDepth: 2
          }]
        })]
      });
      const formatter = (createBotModule as typeof createBotModule).formatUnifiedAddressFinalReport;
      const normal = formatter({
        address: walletAddress,
        whereReport: whereIsMoneyReportForTest(),
        deepReport,
        locale: "en"
      }).text;
      const beta = formatter({
        address: walletAddress,
        whereReport: whereIsMoneyReportForTest(),
        deepReport,
        locale: "en",
        showBetaDiagnostics: true
      }).text;

      expect(normal).toContain("&lt;b&gt;hostile &amp; service&lt;/b&gt;");
      expect(normal).not.toContain("<b>hostile & service</b>");
      expect(normal).not.toContain("Beta/internal");
      expect(beta).toContain("Beta/internal");
      expect(beta).toContain("Weighted layer score");
    });

    it("keeps detailed diagnostics while normal check_status uses the compact fresh bundle", async () => {
      const firstHop = persistedFirstHopEvidenceForTest();
      const deepReport = freshNarrativeDeepReportForTest({
        firstHopBlacklistFacts: firstHop.firstHopBlacklistFacts,
        firstHopLabelFacts: firstHop.firstHopLabelFacts,
        firstHopBlacklistCoverage: firstHop.firstHopBlacklistCoverage
      });
      const persistedDeepResult = persistedDeepResultJsonForTest(deepReport);
      persistedDeepResult.directHardEvidenceSnapshots = firstHop.directHardEvidenceSnapshots;
      const whereReport = whereIsMoneyReportForTest();
      const whereJob = whereIsMoneyJobForTest({
        id: "compact-status-where",
        resultJson: {
          scoringPolicyVersion: SCORING_SIGNAL_MATRIX_POLICY_VERSION,
          subjectAddress: walletAddress,
          whereIsMoneyReport: whereReport
        }
      });
      const deepJob = whereIsMoneyJobForTest({
        id: "compact-status-deep",
        kind: "address_deep_check",
        resultJson: persistedDeepResult
      });
      const { bot, calls } = await createSmokeBot({
        getForensicCheckJob: async () => whereJob,
        getLatestDeepForensicCheckJobForAddressAnyStatus: async () => deepJob
      });

      await bot.handleUpdate(messageUpdate("/check_status compact-status-where", userId));
      const normal = lastPlainText(calls);
      await bot.handleUpdate(messageUpdate("/check_status compact-status-where detailed", userId));
      const detailed = lastPlainText(calls);

      expect(normal).toMatch(/^[🟢🟡🟠🔴] \d+\/100 —/u);
      expect(normal).toMatch(/counterparty.*now on USDT blacklist/i);
      expect(normal).not.toContain("support/debug");
      expect(detailed).toContain("Detailed address report");
      expect(detailed).toContain("Where Is Money");
      expect(detailed).toContain("DeepCheck");
    });

    it("uses exact typed Verify20 only for the checked contract subject", () => {
      const exact = formatUnifiedAddressFinalReportForTest({
        address: walletAddress,
        whereReport: whereIsMoneyReportForTest(),
        deepReport: freshNarrativeDeepReportForTest(),
        smartContractReport: exactVerify20ContractReportForTest(),
        locale: "en"
      });
      const mismatchedReport = exactVerify20ContractReportForTest();
      mismatchedReport.subjectAddress = secondWalletAddress;
      const mismatched = formatUnifiedAddressFinalReportForTest({
        address: walletAddress,
        whereReport: whereIsMoneyReportForTest(),
        deepReport: freshNarrativeDeepReportForTest(),
        smartContractReport: mismatchedReport,
        locale: "en"
      });

      expect(exact).toContain("full Verify20 pattern");
      expect(exact).toContain("Do not proceed");
      expect(mismatched).not.toContain("Verify20");
    });
  });
});
