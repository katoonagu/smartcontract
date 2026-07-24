import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { sendServiceAdminAlert } from "./alerts/adminDelivery";
import { formatIncomingDepositRiskAlert } from "./alerts/formatters";
import { maybeStartAdminDashboard } from "./admin/adminRuntime";
import { startAdminServer } from "./admin/adminServer";
import { normalizeBotLocale } from "./bot/i18n";
import { TRON_USDT_CONTRACT_ADDRESS } from "./parser/transactionParser";
import { runSingleApprovalAllowanceRefreshCycle } from "./approvals/allowanceRefreshWorker";
import { runSingleApprovalContextFinalizerCycle, runSingleApprovalPollingCycle } from "./approvals/approvalWorker";
import { createBot, createRuntimeNavigationProbe, formatDeepForensicFailureUserDeliveryReport, formatDeepForensicUserDeliveryReport, formatWhereIsMoneyUserDeliveryReport } from "./bot/createBot";
import {
  bindApprovalSafetyAuditForContractDecision,
  checkSmartContractAddress as runSmartContractAddressCheck
} from "./check/smartContractCheck";
import { addressPoisoningSmallTransferMaxRaw as parseAddressPoisoningSmallTransferMaxRaw, loadConfig } from "./config";
import { buildContractDecisionEvidenceV1 } from "./forensics/contractDecision";
import { fingerprintCanonicalArtifact } from "./forensics/canonicalJson";
import { enrichContractClassification } from "./forensics/contractEnrichment";
import { runAddressIndexWorkerOnce } from "./forensics/addressIndexWorker";
import { refreshDeepCheckSecondLayerFromIndex } from "./forensics/deepSecondLayerRefresh";
import { createEvmContinuationProvider } from "./forensics/evmContinuationProvider";
import { createEtherscanV2EvmEvidenceProvider } from "./forensics/evmExplorerClient";
import { runForensicJobBatch } from "./forensics/forensicJobBatch";
import { runSingleDeepForensicJobCycle } from "./forensics/deepForensicJob";
import { buildIncomingDepositReport, runSingleIncomingDepositJobCycle, type IncomingDepositRuntimeDeps } from "./forensics/incomingDepositJob";
import { indexedTransferToRouteEdge } from "./forensics/localTronUsdtIndex";
import { withLlmEnrichmentRetry } from "./forensics/llmEnrichmentRetry";
import { createRangeCrossChainDiscoveryProvider, RANGE_ENDPOINT_PATHS } from "./forensics/rangeClient";
import { classifyServiceAddress } from "./forensics/serviceClassifier";
import { addStrictBenchmarkCounters, addStrictBenchmarkStageTiming, buildStrictBenchmarkInitialProgress, type CounterPatch } from "./forensics/strictProvenanceBenchmark";
import { indexTronAddressUsdtHistory } from "./forensics/tronAddressAllTimeIndex";
import { createTronUsdtContinuationProvider } from "./forensics/tronContinuationProvider";
import {
  runSingleForensicTelegramDeliveryCycle,
  type ForensicTelegramDeliveryRepository
} from "./forensics/telegramDeliveryWorker";
import { extractWalletIntelligenceFromJob } from "./forensics/walletIntelligence";
import { logger } from "./logging/logger";
import { createCachedAddressMetadataResolver } from "./metadata/addressMetadataCache";
import {
  addressPoisoningWorkerRepository,
  runSingleAddressPoisoningAlertDeliveryCycle,
  runSingleAddressPoisoningCheckCycle,
  type AddressPoisoningWorkerDeps
} from "./monitor/addressPoisoningWorker";
import { runSinglePollingCycle } from "./monitor/monitorWorker";
import { deepForensicRuntimeOptions } from "./runtime/deepForensicRuntimeOptions";
import {
  createForensicRuntimeOrchestration,
  type ForensicRuntimeOrchestration
} from "./runtime/forensicRuntimeOrchestration";
import {
  createRuntimeCycleRecorder,
  type RuntimeCycleName,
  type RuntimeCycleWorkSummary
} from "./runtime/runtimeLiveProof";
import { buildRuntimeVersion, type RuntimeVersionV1 } from "./runtime/runtimeVersion";
import { runStartupSchemaGate } from "./runtime/startupSchemaGate";
import {
  ADDRESS_POISONING_INTERVAL_MS,
  buildStartupWorkSchedule,
  buildUnifiedResourceWorkSchedule,
  createNonOverlappingStartupWork,
  startStartupWorkSchedule,
  startUnifiedResourceWorkSchedule,
  type StartupWorkLabel,
  type StartupWorkScheduleController,
  type UnifiedResourceWorkLabel
} from "./runtime/startupSchedule";
import { closeDb, createDb } from "./storage/db";
import {
  REQUIRED_SCHEMA_FILENAME,
  REQUIRED_SCHEMA_VERSION,
  SCHEMA_032_FILENAME,
  checksumMigrationBytes,
  verifyRequiredSchema033,
  type Schema033Verification
} from "./storage/schemaMigrations";
import {
  claimObservedTransactionForUserAlert,
  claimDueApprovalContexts,
  claimQueuedTronAddressUsdtIndexStates,
  claimNextForensicCheckJob,
  claimNextForensicTelegramDelivery,
  claimObservedApprovalEvent,
  claimObservedApprovalDrainEvent,
  claimDigestTransactions,
  claimUserAlertsForRetry,
  getApprovalPollState,
  getAddressMetadata,
  getForensicCheckJob,
  getTelegramUserProfile,
  getTheftReport,
  getStaleAddressMetadata,
  getContractIntelligenceProfile,
  getLatestApprovalSafetyAuditForSpenderByTelegramUser,
  getCoveringTronAddressUsdtIndexState,
  getTronAddressUsdtIndexState,
  getWalletPollState,
  hasUndismissedAddressPoisoningCandidateForIncoming,
  completeForensicCheckJob,
  attachRecoveredForensicTelegramDelivery,
  failTronAddressUsdtIndexState,
  markApprovalContextExpired,
  markApprovalContextFinalAlertSent,
  markApprovalContextPending,
  markApprovalContextResolved,
  markApprovalOwnerAlertFailed,
  markApprovalOwnerAlertSent,
  markApprovalOwnerAlertSkipped,
  markWaitingForensicJobsReadyAfterTargetedIndex,
  reconcileWaitingForensicCheckJobs,
  patchWaitingForensicJobsTargetedIndexProgress,
  markStrictProvenanceJobReadyAfterIndex,
  patchStrictBenchmarkProgress,
  getForensicJobTargetedHistoryProgress,
  listCustomerAlertRecipients,
  listAdminForensicCheckJobs,
  listTheftReports,
  countIndexedTronUsdtCounterpartiesForAddress,
  listIndexedTronUsdtTransfersForAddress,
  listIndexedTronUsdtTransfersByHashes,
  listCompletedDeepCheckJobsWithPendingSecondLayer,
  listDueRecoveredForensicDeliveryIntents,
  listDueApprovalAllowanceRefreshTargets,
  findLatestSavedWalletRiskByAddresses,
  getWalletIntelligenceAddressDetail,
  listAddressLabels,
  markDigestSent,
  markUserAlertAnalyzing,
  listWalletApprovalsBySpenderForTelegramUser,
  listWatchedWallets,
  markUserAlertFailed,
  markUserAlertSent,
  markUserAlertSkipped,
  listTronAddressUsdtIndexPages,
  recoverStaleForensicCheckJobs,
  recordApprovalPollFailure,
  recordApprovalPollSuccess,
  recordApprovalRisk,
  recordObservedTransactionRisk,
  releaseForensicCheckJobToWaiting,
  upsertForensicJobWait,
  releaseApprovalContextAfterFailure,
  saveRiskEvaluationEvidence,
  saveWalletApprovalAllowanceStateV2,
  createOrReuseForensicCheckJob,
  getLatestDeepForensicCheckJobForAddress,
  getLatestDeepForensicCheckJobForAddressAnyStatus,
  getLatestWhereIsMoneyCheckJobForAddress,
  indexWalletIntelligenceJobPayload,
  listWalletIntelligenceAddressSummaries,
  queueTronAddressUsdtIndexState,
  saveCompletedDeepSecondLayerContext,
  settleForensicTelegramDelivery,
  settleRecoveredForensicDeliveryIntentPreparation,
  tryAcquireApprovalAllowanceRefreshLock,
  updateForensicCheckJobProgress,
  updateTheftReportAdminState,
  upsertAddressLabelAssertion,
  upsertAddressMetadata,
  upsertContractIntelligenceProfile,
  upsertIndexedTronUsdtTransfers,
  upsertTronAddressUsdtCoverageInterval,
  upsertTronAddressUsdtIndexPage,
  upsertTronAddressUsdtIndexState,
  upsertWalletApproval,
  upsertWalletPollState,
  watchedWalletExists
} from "./storage/repositories";
import type { ForensicCheckJob, ForensicCheckJobKind } from "./storage/repositories";
import type { TelegramMessagePayloadV1 } from "./types";
import { TronscanClient } from "./tron/tronClient";
import { createTronscanScheduler } from "./tron/tronscanScheduler";
import type {
  ContractDecisionEvidenceV1,
  IndexedTronUsdtTransfer,
  TronAddressUsdtIndexRequestKind,
  TronAddressUsdtIndexState
} from "./types";
import {
  buildManualUnifiedResend,
  createPostgresUnifiedDeliveryRepository,
  runUnifiedDeliveryCycle
} from "./unifiedCheck/delivery";
import {
  buildManualResendWarningPresentation
} from "./unifiedCheck/presentation";
import {
  applyUnifiedRecoveryAction,
  createUnifiedPoolTransactionHost,
  ensureUnifiedPresentationForCompletedRequest,
  listUnifiedWatchdogRuns,
  loadUnifiedUnknownDeliveryPresentation,
  persistManualUnifiedResend
} from "./unifiedCheck/repository";
import {
  createPostgresUnifiedRequestStore,
  intakeUnifiedCheck,
  UnifiedProviderWaitError
} from "./unifiedCheck/requestService";
import {
  getActiveCheckGeneration,
  handoffWalletDeliveryAndAcceptRequest,
  ownsWalletDelivery,
  selectUnifiedStartupSchedule
} from "./unifiedCheck/rolloutFence";
import { createTronConfirmedSnapshotSource } from "./unifiedCheck/snapshot";
import { SELECTED_ATTRIBUTION_POLICY } from "./unifiedCheck/selectedAttributionPolicy.generated";
import { SCORING_POLICY_V4 } from "./risk/scoringPolicyV4.generated";
import { createUnifiedProductionRuntime } from "./unifiedCheck/productionRuntime";
import { createUnifiedProviderPool } from "./unifiedCheck/providerPool";
import {
  buildUnifiedCanaryProviderConfiguration
} from "./unifiedCheck/canary";
import { isRetryableUnifiedProviderError } from "./unifiedCheck/productionDirectHistory";
import {
  evidenceDateWithinSnapshot,
  requireCompleteUnifiedBlacklistTimeline
} from "./unifiedCheck/productionEvidence";
import { inspectUnifiedRuns } from "./unifiedCheck/watchdog";
import {
  createPostgresProviderPageStore,
  loadOrFetchProviderPage
} from "./unifiedCheck/providerRequest";

const config = loadConfig();
const addressPoisoningSmallTransferMaxRaw = parseAddressPoisoningSmallTransferMaxRaw(
  config.addressPoisoningSmallTransferMaxUsdt
);
const db = createDb(config.databaseUrl);
const unifiedTransactionHost = createUnifiedPoolTransactionHost(db);
let forensicRuntimeOrchestration: ForensicRuntimeOrchestration;
let runtimeVersion: RuntimeVersionV1;
try {
  let schemaVerification: Schema033Verification | null = null;
  const schema032MigrationBytes = await readFile(
    new URL(`../migrations/${SCHEMA_032_FILENAME}`, import.meta.url)
  );
  const schema032Checksum = await checksumMigrationBytes(schema032MigrationBytes);
  const requiredMigrationBytes = await readFile(
    new URL(`../migrations/${REQUIRED_SCHEMA_FILENAME}`, import.meta.url)
  );
  const requiredChecksum = await checksumMigrationBytes(requiredMigrationBytes);
  forensicRuntimeOrchestration = createForensicRuntimeOrchestration({
    verifyStartupSchema: () => runStartupSchemaGate({
      verify: () =>
        verifyRequiredSchema033(db, requiredChecksum, schema032Checksum),
      onVerified: (verification) => {
        schemaVerification = verification;
        logger.info("schema_migration_verified", {
          version: verification.version,
          shortChecksum: verification.shortChecksum
        });
      }
    }),
    reconcileWaitingForensicJobs: () => reconcileWaitingForensicCheckJobs(db, {
      now: new Date(),
      limit: 100
    }),
    logger
  });
  await forensicRuntimeOrchestration.runVerifiedStartup();
  if (!schemaVerification) throw new Error("runtime_version_schema_verification_missing");
  runtimeVersion = buildRuntimeVersion({
    gitCommitSha: config.runtimeGitSha,
    runtimeInstanceLabel: config.runtimeInstanceLabel,
    migration: schemaVerification
  });
} catch (error) {
  await closeDb(db);
  throw error;
}
const activeCheckGeneration = await getActiveCheckGeneration(db);
logger.info("unified_generation_fence_loaded", {
  deliveryGeneration: activeCheckGeneration.deliveryGeneration,
  generationId: activeCheckGeneration.generationId
});
const runtimeCycleRecorder = createRuntimeCycleRecorder({ runtimeVersion, logger });

async function runRecordedRuntimeCycle<T>(
  cycleName: RuntimeCycleName,
  work: () => Promise<T>,
  summarize: (result: T) => RuntimeCycleWorkSummary
): Promise<T> {
  const cycle = runtimeCycleRecorder.start(cycleName);
  try {
    const result = await work();
    cycle.complete(summarize(result));
    return result;
  } catch (error) {
    cycle.fail();
    throw error;
  }
}
const tronscanScheduler = createTronscanScheduler({
  requestMinIntervalMs: config.tronscanRequestMinIntervalMs,
  globalRequestMinIntervalMs: config.tronscanGlobalRequestMinIntervalMs,
  rateLimitCooldownMs: config.tronscanRateLimitCooldownMs,
  endpointMinIntervalMs: {
    transfer: config.tronscanTransferRequestMinIntervalMs,
    approval: config.tronscanApprovalRequestMinIntervalMs,
    contract: config.tronscanContractRequestMinIntervalMs,
    fullnode: config.tronscanFullNodeRequestMinIntervalMs,
    trongrid: config.tronGridRequestMinIntervalMs
  },
  apiKeys: config.tronscanApiKeys,
  apiKeyGroups: config.tronscanApiKeyGroups,
  accountGroupRequestMinIntervalMs: config.tronscanAccountGroupRequestMinIntervalMs,
  maxInFlight: config.tronscanMaxInFlight,
  maxInFlightPerGroup: config.tronscanGroupMaxInFlight
});
const tronClient = new TronscanClient({
  baseUrl: config.tronscanBaseUrl,
  fullNodeBaseUrl: config.tronFullNodeBaseUrl,
  apiKey: config.tronscanApiKeys,
  fullNodeApiKey: config.tronFullNodeApiKey,
  timeoutMs: config.tronscanTimeoutMs,
  retryAttempts: config.tronscanRetryAttempts,
  retryBaseDelayMs: config.tronscanRetryBaseDelayMs,
  requestMinIntervalMs: config.tronscanRequestMinIntervalMs,
  rateLimitCooldownMs: config.tronscanRateLimitCooldownMs,
  scheduler: tronscanScheduler
});
const unifiedSnapshotSource = createTronConfirmedSnapshotSource({
  fullNodeBaseUrl: config.tronFullNodeBaseUrl,
  fullNodeApiKey: config.tronFullNodeApiKey,
  timeoutMs: config.tronscanTimeoutMs
});
const unifiedRequestStore = createPostgresUnifiedRequestStore(
  unifiedTransactionHost
);
const unifiedLabelRows = (
  await db.query(
    `select address, label, label as category, source as provider,
            created_at as observed_at
       from address_labels
      union all
     select address, label, category, provider, updated_at as observed_at
       from address_labels_cache
      where chain = 'tron'
      order by address, category, label, provider, observed_at`
  )
).rows.map((row) => ({
  address: String(row.address),
  label: String(row.label),
  category: String(row.category),
  provider: String(row.provider),
  observedAt: new Date(String(row.observed_at)).toISOString()
}));
const unifiedLabelSnapshot = {
  version: "unified-label-dataset-v1" as const,
  rows: unifiedLabelRows
};
const UNIFIED_LABEL_DATASET_SHA256 =
  fingerprintCanonicalArtifact(unifiedLabelSnapshot);
const persistedUnifiedLabelDataset = (
  await db.query(
    `insert into unified_label_datasets (sha256, dataset_json)
     values ($1,$2::jsonb)
     on conflict (sha256) do nothing
     returning dataset_json`,
    [
      UNIFIED_LABEL_DATASET_SHA256,
      JSON.stringify(unifiedLabelSnapshot)
    ]
  )
).rows[0] ?? (
  await db.query(
    "select dataset_json from unified_label_datasets where sha256 = $1",
    [UNIFIED_LABEL_DATASET_SHA256]
  )
).rows[0];
if (
  !persistedUnifiedLabelDataset ||
  fingerprintCanonicalArtifact(
    persistedUnifiedLabelDataset.dataset_json
  ) !== UNIFIED_LABEL_DATASET_SHA256
) {
  throw new Error("unified_label_dataset_persistence_mismatch");
}
const unifiedProviderPageStore = createPostgresProviderPageStore(
  unifiedTransactionHost
);
const unifiedProviderConfiguration =
  buildUnifiedCanaryProviderConfiguration({
    tronscanBaseUrl: config.tronscanBaseUrl,
    tronFullNodeBaseUrl: config.tronFullNodeBaseUrl,
    timeoutMs: config.tronscanTimeoutMs,
    retryAttempts: config.tronscanRetryAttempts,
    retryBaseDelayMs: config.tronscanRetryBaseDelayMs,
    rateLimitCooldownMs: config.tronscanRateLimitCooldownMs,
    maxInFlight: config.tronscanMaxInFlight ?? 20,
    maxInFlightPerGroup: config.tronscanGroupMaxInFlight ?? 2,
    requestMinIntervalMs: config.tronscanRequestMinIntervalMs,
    globalRequestMinIntervalMs: config.tronscanGlobalRequestMinIntervalMs,
    transferRequestMinIntervalMs:
      config.tronscanTransferRequestMinIntervalMs,
    approvalRequestMinIntervalMs:
      config.tronscanApprovalRequestMinIntervalMs,
    contractRequestMinIntervalMs:
      config.tronscanContractRequestMinIntervalMs,
    fullNodeRequestMinIntervalMs:
      config.tronscanFullNodeRequestMinIntervalMs,
    tronGridRequestMinIntervalMs: config.tronGridRequestMinIntervalMs,
    accountGroupRequestMinIntervalMs:
      config.tronscanAccountGroupRequestMinIntervalMs,
    tronscanKeyCount: config.tronscanApiKeys.length,
    fullNodeKeyConfigured: Boolean(config.tronFullNodeApiKey),
    groups: config.tronscanApiKeyGroups.map((group) => ({
      groupId: group.groupId,
      keyCount: group.apiKeys.length
    }))
  });
let wakeUnifiedProviderPool: () => void = () => undefined;
const unifiedProductionRuntime = createUnifiedProductionRuntime({
  db: unifiedTransactionHost,
  runtimeCommit: runtimeVersion.gitCommitSha,
  providerConfigurationSha256: unifiedProviderConfiguration.sha256,
  now: () => new Date(),
  createId: randomUUID,
  onProviderWorkAvailable: () => wakeUnifiedProviderPool(),
  async loadProviderPage({
    run,
    address = run.subjectAddress,
    cursor,
    onDiagnostic
  }) {
    const start = cursor === null ? 0 : Number(cursor);
    if (!Number.isSafeInteger(start) || start < 0) {
      throw new Error("unified_direct_history_cursor_invalid");
    }
    try {
      const cached = await loadOrFetchProviderPage({
        identity: {
          chain: "tron",
          providerFamily: "tronscan",
          endpoint: "/api/token_trc20/transfers",
          apiSchemaVersion: "tronscan-transfer-page-v1",
          address,
          tokenContract: TRON_USDT_CONTRACT_ADDRESS,
          blockStart: "0",
          blockEnd: run.analysisManifest.confirmedBlockNumber,
          direction: "both",
          order: "desc",
          pageSize: 50,
          cursor,
          snapshotBlockNumber:
            run.analysisManifest.confirmedBlockNumber,
          snapshotBlockHash: run.analysisManifest.confirmedBlockHash,
          confirmationPolicy: "walletsolidity-confirmed-cutoff-v1"
        },
        store: unifiedProviderPageStore,
        onDiagnostic,
        async fetchPage() {
          const loaded =
            await tronClient.listRelatedTrc20TransferPagePinned(
              address,
              {
                start,
                limit: 50,
                endTimestamp: Date.parse(
                  run.analysisManifest.confirmedBlockTimestamp
                )
              }
            );
          if (loaded.metadataConsistent !== true) {
            throw new Error(
              "unified_direct_history_provider_metadata_inconsistent"
            );
          }
          return {
            payload: {
              provider: loaded.provider,
              transfers: loaded.transfers,
              nextOffset: loaded.nextOffset,
              complete: loaded.complete,
              metadataConsistent: loaded.metadataConsistent,
              rawResponseHashes: loaded.rawResponseHashes,
              canonicalTransferHashes: loaded.canonicalTransferHashes
            },
            snapshotBlockNumber:
              run.analysisManifest.confirmedBlockNumber,
            snapshotBlockHash: run.analysisManifest.confirmedBlockHash,
            cursor,
            providerFamily: loaded.provider,
            endpoint: "/api/token_trc20/transfers",
            apiSchemaVersion: "tronscan-transfer-page-v1",
            fetchedAt: new Date().toISOString(),
            provenance: {
              rawResponseHashes: loaded.rawResponseHashes,
              canonicalTransferHashes: loaded.canonicalTransferHashes,
              metadataConsistent: loaded.metadataConsistent
            }
          };
        }
      });
      const loaded = cached.payload as {
        provider: "tronscan" | "trongrid_fallback";
        transfers: Awaited<
          ReturnType<typeof tronClient.listRelatedTrc20TransferPagePinned>
        >["transfers"];
        nextOffset: number;
        complete: boolean;
        metadataConsistent: boolean;
      };
      if (
        (
          loaded.provider !== "tronscan" &&
          loaded.provider !== "trongrid_fallback"
        ) ||
        !Array.isArray(loaded.transfers) ||
        !Number.isSafeInteger(loaded.nextOffset) ||
        typeof loaded.complete !== "boolean" ||
        loaded.metadataConsistent !== true
      ) {
        throw new Error("unified_direct_history_cached_page_invalid");
      }
      const content = {
        kind: "page" as const,
        cursor,
        nextCursor: loaded.complete ? null : String(loaded.nextOffset),
        transfers: loaded.transfers,
        reachedAccountCreation: loaded.complete,
        provider: loaded.provider
      };
      return {
        ...content,
        pageHash: fingerprintCanonicalArtifact(content)
      };
    } catch (error) {
      const reason = error instanceof Error
        ? error.message
        : "unified_direct_history_provider_failed";
      if (isRetryableUnifiedProviderError(error)) {
        return {
          kind: "provider_wait" as const,
          readyAt: new Date(Date.now() + 30_000).toISOString(),
          reason
        };
      }
      throw error;
    }
  },
  async loadCounterpartyLabels({ addresses, labelDatasetSha256 }) {
    const stored = (
      await db.query(
        "select dataset_json from unified_label_datasets where sha256 = $1",
        [labelDatasetSha256]
      )
    ).rows[0]?.dataset_json as {
      version?: unknown;
      rows?: unknown;
    } | undefined;
    if (
      !stored ||
      stored.version !== "unified-label-dataset-v1" ||
      !Array.isArray(stored.rows) ||
      fingerprintCanonicalArtifact(stored) !== labelDatasetSha256
    ) {
      throw new Error("unified_label_dataset_persistence_mismatch");
    }
    const requested = new Set(addresses);
    const labels = new Map<string, string[]>();
    for (const raw of stored.rows) {
      const row = raw as {
        address?: unknown;
        label?: unknown;
        category?: unknown;
      };
      if (
        typeof row.address !== "string" ||
        !requested.has(row.address) ||
        typeof row.label !== "string" ||
        typeof row.category !== "string"
      ) continue;
      labels.set(row.address, [...new Set([
        ...(labels.get(row.address) ?? []),
        row.label,
        row.category
      ])].sort());
    }
    return labels;
  },
  async loadHardEvidence({
    subjectAddress,
    snapshotTimestamp,
    events,
    knownCounterparties,
    cooperate,
    providerCall
  }) {
    const riskyLabels = new Set([
      "scam",
      "reported_scam",
      "stolen_funds",
      "phishing",
      "risky_contract",
      "approval_drain_proximity",
      "darknet_exchange"
    ]);
    const isRisky = (address: string | null) =>
      address !== null &&
      (knownCounterparties.get(address) ?? [])
        .some((label) => riskyLabels.has(label));
    try {
      const addresses = [...new Set(events.flatMap((event) => [
        event.fromAddress,
        event.toAddress
      ]))].sort();
      const timelines = [];
      for (const address of addresses) {
        await cooperate();
        timelines.push({
          address,
          timeline: await providerCall(() =>
            tronClient.getUsdtBlacklistTimeline(address)
          )
        });
        await cooperate();
      }
      const timelineByAddress = new Map(
        timelines.map((item) => [
          item.address,
          requireCompleteUnifiedBlacklistTimeline(item.timeline)
        ])
      );
      const blacklistedAtEventKeys = new Set<string>();
      for (const event of events) {
        const counterparty = event.fromAddress === subjectAddress
          ? event.toAddress
          : event.fromAddress;
        const history = [...(timelineByAddress.get(counterparty) ?? [])]
          .filter((item) =>
            Date.parse(item.occurredAt) <= event.blockTimestamp.getTime()
          )
          .sort((left, right) =>
            Date.parse(left.occurredAt) - Date.parse(right.occurredAt)
          );
        if (history.at(-1)?.eventKind === "added") {
          blacklistedAtEventKeys.add(
            `${event.txHash}:${event.eventIndex}`
          );
        }
      }
      const approvals = [];
      for (let start = 0; ; start += 50) {
        await cooperate();
        const page = await providerCall(() =>
          tronClient.listTrc20Approvals(
            subjectAddress,
            { start, limit: 50 }
          )
        );
        await cooperate();
        approvals.push(...page.approvals);
        if (
          page.approvals.length === 0 ||
          (page.total !== null && approvals.length >= page.total)
        ) break;
      }
      const dangerousApprovalIds = new Set(
        approvals
          .filter((approval) =>
            evidenceDateWithinSnapshot(
              approval.operateTime,
              snapshotTimestamp
            ) &&
            approval.tokenContract === TRON_USDT_CONTRACT_ADDRESS &&
            approval.isUnlimited &&
            BigInt(approval.amountRaw) > 0n &&
            isRisky(approval.spenderAddress)
          )
          .map((approval) => approval.spenderAddress)
      );
      const confirmedVictimDebitEventKeys = new Set(
        events
          .filter((event) =>
            event.method === "transferFrom" &&
            event.fromAddress === subjectAddress &&
            event.callerAddress !== subjectAddress &&
            isRisky(event.callerAddress)
          )
          .map((event) => `${event.txHash}:${event.eventIndex}`)
      );
      return {
        blacklistedAtEventKeys,
        dangerousApprovalIds,
        confirmedVictimDebitEventKeys
      };
    } catch (error) {
      const reason = error instanceof Error
        ? error.message
        : "unified_hard_evidence_failed";
      if (
        reason !==
          "unified_blacklist_timeline_incomplete:provider_failed" &&
        !isRetryableUnifiedProviderError(error)
      ) {
        throw error;
      }
      throw new UnifiedProviderWaitError(
        new Date(Date.now() + 30_000).toISOString(),
        reason
      );
    }
  }
});
const unifiedProviderPool = createUnifiedProviderPool({
  slots: Math.min(4, Math.max(1, config.tronscanApiKeys.length)),
  runCycle: (slotId) =>
    unifiedProductionRuntime.runProviderCycle(slotId),
  onError(error, slotId) {
    logger.error("unified_provider_pool_slot_failed", {
      slotId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});
wakeUnifiedProviderPool = () => unifiedProviderPool.wake();
const runRuntimeNavigationProbe = createRuntimeNavigationProbe(config, db, tronClient, runtimeVersion);

function getBackgroundUsdtAllowance(input: {
  ownerAddress: string;
  spenderAddress: string;
  signal: AbortSignal;
}): Promise<string> {
  // ponytail: one-shot client buys a cancellable no-retry call; reuse it once TronApprovalClient accepts AbortSignal.
  const client = new TronscanClient({
    baseUrl: config.tronscanBaseUrl,
    fullNodeBaseUrl: config.tronFullNodeBaseUrl,
    fullNodeApiKey: config.tronFullNodeApiKey,
    timeoutMs: 15_000,
    retryAttempts: 0,
    fetchFn: (resource, init = {}) => fetch(resource, {
      ...init,
      signal: AbortSignal.any([
        input.signal,
        ...(init.signal ? [init.signal] : [])
      ])
    })
  });
  return client.getUsdtAllowance(input);
}
const addressPoisoningTronClient = new TronscanClient({
  baseUrl: config.tronscanBaseUrl,
  fullNodeBaseUrl: config.tronFullNodeBaseUrl,
  apiKey: config.tronscanApiKeys,
  fullNodeApiKey: config.tronFullNodeApiKey,
  timeoutMs: 5_000,
  retryAttempts: 0,
  retryBaseDelayMs: config.tronscanRetryBaseDelayMs,
  schedulerDedupeNamespace: "address_poisoning",
  transferSchedulingPriority: "interactive_fast",
  requestMinIntervalMs: config.tronscanRequestMinIntervalMs,
  rateLimitCooldownMs: config.tronscanRateLimitCooldownMs,
  scheduler: tronscanScheduler
});
// ponytail: inline where-hop history is latency-sensitive; move to background/index queue if we need deeper per-hop proof.
const TARGETED_HISTORY_INLINE_MAX_PAGES = 4;
const TARGETED_HISTORY_BACKGROUND_MAX_PAGES = 200;
const TARGETED_HISTORY_BACKGROUND_MAX_PAGES_PER_HOP = 12000;
const TARGETED_HISTORY_BACKGROUND_MAX_WINDOW_SPLIT_DEPTH = 24;
const TARGETED_HISTORY_BACKGROUND_MAX_ATTEMPTS = 8;
const TARGETED_HISTORY_BACKGROUND_ESCALATION_FACTOR = 2;
const crossChainDiscoveryProvider = config.crossChainStage2Enabled && config.rangeApiKey
  ? createRangeCrossChainDiscoveryProvider({
      apiKey: config.rangeApiKey,
      baseUrl: config.rangeBaseUrl,
      timeoutMs: config.rangeTimeoutMs,
      endpointPaths: RANGE_ENDPOINT_PATHS,
      allowUndocumentedRawAmountFields: true
    })
  : undefined;
const evmEvidenceProvider = config.crossChainStage2Enabled && config.evmExplorerApiKey
  ? createEtherscanV2EvmEvidenceProvider({
      apiKey: config.evmExplorerApiKey,
      baseUrl: config.evmExplorerBaseUrl,
      timeoutMs: config.evmExplorerTimeoutMs,
      maxPagesPerQuery: config.evmExplorerMaxCallsPerCheck
    })
  : undefined;
const crossChainContinuationProviders = config.crossChainStage2Enabled
  ? [
      createTronUsdtContinuationProvider({ tronClient }),
      ...(evmEvidenceProvider
        ? [
            createEvmContinuationProvider({ chain: "ethereum", evmProvider: evmEvidenceProvider }),
            createEvmContinuationProvider({ chain: "arbitrum", evmProvider: evmEvidenceProvider }),
            createEvmContinuationProvider({ chain: "bsc", evmProvider: evmEvidenceProvider })
          ]
        : [])
    ]
  : [];

logger.info("tronscan_scheduler_configured", tronscanScheduler.diagnostics());

const adminDashboard = await maybeStartAdminDashboard({
  config,
  startAdminServer: (adminDeps) => startAdminServer({
    ...adminDeps,
    listUnifiedRuns: () => listUnifiedWatchdogRuns(db),
    applyUnifiedRecoveryAction: async (input) => {
      if (input.action !== "manual-delivery") {
        return applyUnifiedRecoveryAction(unifiedTransactionHost, {
          ...input,
          action: input.action
        });
      }
      if (input.targetId === null) {
        return { ok: false, code: "manual_delivery_target_required" };
      }
      try {
        const original = await loadUnifiedUnknownDeliveryPresentation(db, {
          runId: input.runId,
          deliveryId: input.targetId
        });
        const warningPresentation =
          buildManualResendWarningPresentation(original.presentation);
        const operation = buildManualUnifiedResend({
          operationId: randomUUID(),
          actorId: input.actorId,
          requestedAt: new Date().toISOString(),
          originalDeliveryId: input.targetId,
          originalStatus: original.originalStatus,
          originalPresentationHash: original.originalPresentationHash,
          warningPresentationHash: warningPresentation.presentationHash
        });
        await persistManualUnifiedResend(unifiedTransactionHost, {
          operation,
          deliveryId: randomUUID(),
          warningPresentation
        });
        return { ok: true, code: "manual_delivery_created" };
      } catch (error) {
        return {
          ok: false,
          code: error instanceof Error
            ? error.message
            : "manual_delivery_failed"
        };
      }
    },
    refreshDeepCheckSecondLayer: (jobId) => refreshDeepCheckSecondLayerJob(jobId),
    listWalletIntelligenceAddressSummaries: (input) => listWalletIntelligenceAddressSummaries(db, input),
    getWalletIntelligenceAddressDetail: (address) => getWalletIntelligenceAddressDetail(db, address),
    createStrictProvenanceBenchmarkJob: async ({ subjectAddress }) => {
      const now = new Date();
      return createOrReuseForensicCheckJob(db, {
        kind: "where_is_money_check",
        subjectAddress,
        windowStart: new Date(0),
        windowEnd: now,
        priority: 260,
        chatId: null,
        requestedBy: "admin_strict_benchmark",
        progressJson: buildStrictBenchmarkInitialProgress({
          locale: "ru",
          keyCount: tronscanScheduler.diagnostics().apiKeyCount,
          accountGroupCount: tronscanScheduler.diagnostics().apiKeyGroupCount,
          now
        })
      });
    }
  }),
  listJobs: (input) => listAdminForensicCheckJobs(db, input),
  getJob: (id) => getForensicCheckJob(db, id),
  listTheftReports: (input) => listTheftReports(db, input),
  getTheftReport: (id) => getTheftReport(db, id),
  updateTheftReportAdminState: (input) => updateTheftReportAdminState(db, input),
  getTargetedHistoryProgressForJob: (jobId) => getForensicJobTargetedHistoryProgress(db, jobId),
  listIndexedUsdtTransfersByHashes: (txHashes) => listIndexedTronUsdtTransfersByHashes(db, txHashes),
  findLatestSavedWalletRiskByAddresses: (addresses) => findLatestSavedWalletRiskByAddresses(db, addresses),
  getRuntimeProof: () => runtimeCycleRecorder.proof(),
  runRuntimeNavigationProbe
});
if (adminDashboard) logger.info("admin_dashboard_started", { url: adminDashboard.url });

let activePoll: Promise<void> | null = null;
let activeWhereForensicPoll: Promise<void> | null = null;
let activeDeepForensicPoll: Promise<void> | null = null;
let activeIncomingDepositPoll: Promise<void> | null = null;
let activeAddressIndexPoll: Promise<void> | null = null;
let shuttingDown = false;

const getCachedOrLiveAddressMetadata = createCachedAddressMetadataResolver({
  getFresh: (address, now) => getAddressMetadata(db, address, now),
  getStale: (address) => getStaleAddressMetadata(db, address),
  fetchLive: (address) => withLlmEnrichmentRetry({
    label: "address_metadata",
    address,
    maxAttempts: config.llmEnrichmentMaxAttempts,
    retryDelayMs: config.llmEnrichmentRetryDelayMs,
    logger
  }, () => tronClient.getAddressMetadata(address, { requireComplete: true })),
  upsert: (metadata) => upsertAddressMetadata(db, metadata),
  logger
});

function shouldRefreshContractProfileForLlm(profile: { lowMetadata?: boolean | null } | null): boolean {
  return profile?.lowMetadata === true;
}

async function getCachedOrLiveContractIntelligenceProfile(address: string, now = new Date()) {
  const cached = await getContractIntelligenceProfile(db, address, now).catch((error) => {
    logger.warn("contract_profile_cache_read_failed", {
      address,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  });
  if (cached && !shouldRefreshContractProfileForLlm(cached)) return cached;

  const live = await withLlmEnrichmentRetry({
    label: "contract_profile",
    address,
    maxAttempts: config.llmEnrichmentMaxAttempts,
    retryDelayMs: config.llmEnrichmentRetryDelayMs,
    logger
  }, () => tronClient.getContractIntelligenceProfile(address, { now, requireComplete: true })).catch((error) => {
    logger.warn("contract_profile_live_fetch_failed", {
      address,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  });
  if (!live) return null;

  await upsertContractIntelligenceProfile(db, live).catch((error) => {
    logger.warn("contract_profile_cache_write_failed", {
      address,
      error: error instanceof Error ? error.message : String(error)
    });
  });
  return live;
}

async function ensureAddressUsdtHistory(input: {
  address: string;
  coverageMode: "all_time" | "targeted";
  targetTimestamp?: Date | null;
  stopAtTimestamp?: Date | null;
  requestKind?: TronAddressUsdtIndexRequestKind | null;
  windowStartTimestamp?: Date | null;
  windowEndTimestamp?: Date | null;
  relatedHopTxHash?: string | null;
  candidateTxHash?: string | null;
  requestedByJobId?: string | null;
  queuedReason: string;
  maxPagesPerRun?: number | null;
  maxWindowSplitDepth?: number | null;
  lockOwner?: string | null;
  lockMs?: number | null;
}) {
  const targetTimestamp = input.targetTimestamp ?? input.stopAtTimestamp ?? input.windowEndTimestamp ?? null;
  const existing = await getTronAddressUsdtIndexState(db, {
    address: input.address,
    coverageMode: input.coverageMode,
    targetTimestamp,
    requestKind: input.requestKind ?? "broad_targeted",
    windowStartTimestamp: input.windowStartTimestamp ?? null,
    windowEndTimestamp: input.windowEndTimestamp ?? null,
    candidateTxHash: input.candidateTxHash ?? null
  });
  if (existing?.status === "complete" && existing.statusReason === "complete_provider_windowed") return existing;

  const completedPages = await listTronAddressUsdtIndexPages(db, {
    address: input.address,
    coverageMode: input.coverageMode,
    targetTimestampMs: input.coverageMode === "targeted" ? targetTimestamp?.getTime() ?? 0 : 0
  });
  let benchmarkPatchChain: Promise<void> = Promise.resolve();
  const patchStrictBenchmarkMetrics = async (
    buildProgress: (progressJson: Record<string, unknown>) => Record<string, any>
  ): Promise<void> => {
    if (!input.requestedByJobId) return;
    benchmarkPatchChain = benchmarkPatchChain
      .catch(() => undefined)
      .then(async () => {
        const existingJob = await getForensicCheckJob(db, input.requestedByJobId!).catch(() => null);
        if (existingJob?.progressJson.strictProvenanceBenchmark !== true) return;
        const progress = buildProgress(existingJob.progressJson);
        await patchStrictBenchmarkProgress(db, {
          id: input.requestedByJobId!,
          patchJson: {
            strictBenchmarkMetrics: progress.strictBenchmarkMetrics
          }
        });
      })
      .catch((error) => {
        logger.warn("strict_benchmark_metric_patch_failed", {
          jobId: input.requestedByJobId,
          address: input.address,
          error: error instanceof Error ? error.message : String(error)
        });
      });
    await benchmarkPatchChain;
  };
  const patchBenchmarkStage = async (stage: "apiMs" | "dbWriteMs", elapsedMs: number): Promise<void> => {
    await patchStrictBenchmarkMetrics((progressJson) =>
      addStrictBenchmarkStageTiming(progressJson, stage, elapsedMs)
    );
  };
  const patchBenchmarkCounters = async (patch: CounterPatch): Promise<void> => {
    await patchStrictBenchmarkMetrics((progressJson) =>
      addStrictBenchmarkCounters(progressJson, patch)
    );
  };
  const extendIndexLock = async (): Promise<void> => {
    if (!input.lockOwner || !input.lockMs) return;
    const now = new Date();
    await upsertTronAddressUsdtIndexState(db, {
      address: input.address,
      coverageMode: input.coverageMode,
      targetTimestamp,
      requestKind: input.requestKind ?? existing?.requestKind ?? "broad_targeted",
      windowStartTimestamp: input.windowStartTimestamp ?? existing?.windowStartTimestamp ?? null,
      windowEndTimestamp: input.windowEndTimestamp ?? existing?.windowEndTimestamp ?? null,
      relatedHopTxHash: input.relatedHopTxHash ?? existing?.relatedHopTxHash ?? null,
      candidateTxHash: input.candidateTxHash ?? existing?.candidateTxHash ?? null,
      status: "running",
      requestedByJobId: input.requestedByJobId ?? existing?.requestedByJobId ?? null,
      queuedReason: input.queuedReason,
      lockedUntil: new Date(now.getTime() + Math.max(1, input.lockMs)),
      heartbeatAt: now,
      lockOwner: input.lockOwner
    });
  };

  const state = await indexTronAddressUsdtHistory({
    address: input.address,
    coverageMode: input.coverageMode,
    targetTimestamp,
    stopAtTimestamp: input.stopAtTimestamp ?? null,
    requestKind: input.requestKind ?? "broad_targeted",
    windowStartTimestamp: input.windowStartTimestamp ?? null,
    windowEndTimestamp: input.windowEndTimestamp ?? null,
    relatedHopTxHash: input.relatedHopTxHash ?? null,
    candidateTxHash: input.candidateTxHash ?? null,
    initialState: existing,
    initialPagesByKey: new Map(completedPages
      .filter((page) => (page.status === "complete" || page.status === "empty") && page.rawResponseHash && page.canonicalTransferHash)
      .map((page) => [`${page.windowStartTimestampMs}:${page.windowEndTimestampMs}:${page.startOffset}`, {
        rawResponseHash: page.rawResponseHash,
        canonicalTransferHash: page.canonicalTransferHash,
        status: page.status,
        transferCount: page.transferCount,
        provider: page.provider,
        totalReported: page.totalReported,
        rangeTotal: page.rangeTotal,
        newestTransferAt: page.newestTransferAt,
        oldestTransferAt: page.oldestTransferAt
      }])),
    pageLimit: config.tronscanPageLimit,
    pageBatchSize: config.tronAddressIndexPageBatchSize,
    maxPagesPerRun: input.maxPagesPerRun ??
      (input.coverageMode === "targeted" ? TARGETED_HISTORY_INLINE_MAX_PAGES : undefined),
    maxWindowSplitDepth: input.maxWindowSplitDepth ?? undefined,
    requestedByJobId: input.requestedByJobId ?? null,
    queuedReason: input.queuedReason,
    onBenchmarkStageTiming: patchBenchmarkStage,
    onBenchmarkCounters: patchBenchmarkCounters,
    onProgressHeartbeat: extendIndexLock,
    listTransferPage: (address, options) => tronClient.listRelatedTrc20TransferPage(address, options),
    upsertTransfers: (transfers) => upsertIndexedTronUsdtTransfers(db, transfers),
    countIndexedCounterparties: (address) => countIndexedTronUsdtCounterpartiesForAddress(db, address),
    upsertState: (state) => upsertTronAddressUsdtIndexState(db, state),
    upsertPage: (page) => upsertTronAddressUsdtIndexPage(db, page),
    upsertCoverageInterval: (interval) => upsertTronAddressUsdtCoverageInterval(db, interval)
  });
  const wakeJobId = state.requestedByJobId ?? input.requestedByJobId ?? null;
  if (wakeJobId && input.coverageMode === "targeted" && shouldWakeTargetedWaiterAfterEnsure(state)) {
    await markStrictProvenanceJobReadyAfterIndex(db, {
      id: wakeJobId,
      address: state.address,
      targetTimestamp: state.targetTimestamp,
      indexStatus: state.status,
      statusReason: state.statusReason,
      lastError: state.lastError
    });
  }
  return state;
}

function shouldWakeTargetedWaiterAfterEnsure(state: TronAddressUsdtIndexState): boolean {
  if (state.status === "complete" || state.status === "failed_terminal") return true;
  if (state.status !== "partial") return false;
  if (state.statusReason === "partial_provider_inconsistent" ||
    state.statusReason === "too_large_deferred" ||
    state.statusReason === "failed_terminal") {
    return true;
  }
  if (state.statusReason === "partial_provider_cap") {
    return state.attemptCount >= Math.max(state.maxAttempts, TARGETED_HISTORY_BACKGROUND_MAX_ATTEMPTS);
  }
  return false;
}

const bot = createBot(config, db, tronClient, {
  runtimeVersion,
  createUnifiedCheckRequest: async (request) => {
    if (!ownsWalletDelivery(activeCheckGeneration, "unified")) return false;
    const now = new Date();
    const requestId = randomUUID();
    await handoffWalletDeliveryAndAcceptRequest(unifiedTransactionHost, {
      subjectAddress: request.subjectAddress,
      chatId: request.chatId,
      generationId: activeCheckGeneration.generationId,
      acquiredAt: now.toISOString(),
      request: {
        id: requestId,
        requestCorrelationId: request.requestCorrelationId,
        subjectAddress: request.subjectAddress,
        chatId: request.chatId,
        messageThreadId: request.messageThreadId,
        locale: request.locale,
        runPurpose: "user_check",
        sideEffectPolicy: "authoritative",
        status: "ACCEPTED",
        statusReason: null,
        runId: null,
        readyAt: now.toISOString(),
        attemptCount: 0,
        acceptedAt: now.toISOString()
      }
    });
    const intake = await intakeUnifiedCheck({
      store: unifiedRequestStore,
      snapshotSource: unifiedSnapshotSource,
      request: {
        id: requestId,
        requestCorrelationId: request.requestCorrelationId,
        subjectAddress: request.subjectAddress,
        chatId: request.chatId,
        messageThreadId: request.messageThreadId,
        locale: request.locale,
        runPurpose: "user_check",
        sideEffectPolicy: "authoritative"
      },
      candidateRunId: randomUUID(),
      initialTasks: ([
        "direct_history",
        "deep_direct",
        "traversal",
        "fast",
        "where",
        "deep"
      ] as const)
        .map((kind) => ({
        id: randomUUID(),
        kind,
        priorityLane: "interactive" as const,
        logicalKey: "main"
        })),
      versions: {
        labelDatasetSha256: UNIFIED_LABEL_DATASET_SHA256,
        scoringPolicyVersion: SCORING_POLICY_V4.version,
        attributionPolicyVersion: SELECTED_ATTRIBUTION_POLICY.version,
        runtimeCommit: runtimeVersion.gitCommitSha,
        schemaVersion: REQUIRED_SCHEMA_VERSION
      },
      now: () => now
    });
    logger.info("unified_wallet_check_intake", {
      requestCorrelationId: request.requestCorrelationId,
      subjectAddress: request.subjectAddress,
      outcome: intake.kind
    });
    if (
      intake.kind === "attached" &&
      intake.run.status === "COMPLETED" &&
      intake.request.sideEffectPolicy === "authoritative"
    ) {
      await ensureUnifiedPresentationForCompletedRequest(
        unifiedTransactionHost,
        {
          requestId: intake.request.id,
          deliveryId: randomUUID()
        }
      ).catch((error) => {
        logger.error("unified_completed_request_delivery_reconcile_failed", {
          requestId: intake.request.id,
          runId: intake.run.id,
          error: error instanceof Error ? error.message : String(error)
        });
      });
    }
    return true;
  },
  checkSmartContractAddress: async ({ address, telegramUserId }) => {
    const metadata = await getCachedOrLiveAddressMetadata(address).catch((error) => {
      logger.warn("smart_contract_metadata_lookup_failed", {
        address,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    });
    const contractProfile = metadata?.isContract === true || metadata === null
      ? await getCachedOrLiveContractIntelligenceProfile(address).catch(() => null)
      : null;
    if (metadata?.isContract !== true && !contractProfile) return { kind: "not_contract" };
    if (!metadata) return { kind: "unavailable", error: "contract metadata unavailable" };
    const relatedApprovals = telegramUserId
      ? await listWalletApprovalsBySpenderForTelegramUser(db, { telegramUserId, spenderAddress: address }).catch((error) => {
          logger.warn("smart_contract_approval_lookup_failed", {
            address,
            telegramUserId,
            error: error instanceof Error ? error.message : String(error)
          });
          throw new Error("approval relation lookup failed");
        })
      : [];
    const serviceClassification = classifyServiceAddress({ address, metadata, contractProfile });
    const approvalAudit = telegramUserId
      ? await getLatestApprovalSafetyAuditForSpenderByTelegramUser(db, {
          telegramUserId,
          spenderAddress: address
        }).catch((error) => {
          logger.warn("smart_contract_approval_safety_audit_lookup_failed", {
            address,
            telegramUserId,
            error: error instanceof Error ? error.message : String(error)
          });
          return null;
        })
      : null;
    const approvalBinding = approvalAudit
      ? bindApprovalSafetyAuditForContractDecision({
          subjectAddress: address,
          approvalEvidenceId: approvalAudit.approvalEvidenceId,
          sessionEvidenceId: approvalAudit.sessionEvidenceId,
          campaignEvidence: approvalAudit.campaignEvidence,
          assessment: approvalAudit.assessment
        })
      : null;
    const approvalSafetyAssessments = approvalBinding ? [approvalBinding.assessment] : [];
    const structuralEvidence = buildContractDecisionEvidenceV1({
      subjectAddress: address,
      metadata,
      contractProfile,
      serviceClassification,
      approvalSafetyAssessments
    });
    const contractDecisionEvidence: ContractDecisionEvidenceV1[] = [
      ...structuralEvidence,
      ...(approvalBinding?.evidence ?? [])
    ];
    return {
      kind: "report",
      report: await runSmartContractAddressCheck({
        address,
        metadata,
        contractProfile,
        serviceClassification,
        relatedApprovals,
        approvalSafetyAssessments,
        contractDecisionEvidence
      })
    };
  }
});

const incomingDepositRuntimeDeps: IncomingDepositRuntimeDeps = {
  listIndexedUsdtTransfersForAddress: (address, options) => listIndexedTronUsdtTransfersForAddress(db, {
    address,
    minTimestamp: options.minTimestamp,
    maxTimestamp: options.maxTimestamp,
    limit: options.limit,
    offset: options.offset,
    orderBy: options.orderBy,
    direction: options.direction
  }),
  listRelatedTrc20Transfers: (address, options) => tronClient.listRelatedTrc20Transfers(address, options),
  getLabelsForAddress: (address) => listAddressLabels(db, address),
  getClassificationForAddress: async (address) => {
    const metadata = await getCachedOrLiveAddressMetadata(address);
    const contractProfile = metadata?.isContract === true
      ? await getCachedOrLiveContractIntelligenceProfile(address)
      : null;
    return classifyServiceAddress({ address, metadata, contractProfile });
  },
  getContractIntelligenceProfile: (address) => getCachedOrLiveContractIntelligenceProfile(address),
  enrichContractClassification: (address) => enrichContractClassification({
    address,
    getMetadata: (candidate) => getCachedOrLiveAddressMetadata(candidate),
    getCachedProfile: (candidate, now) => getContractIntelligenceProfile(db, candidate, now),
    fetchLiveProfile: (candidate, now) => withLlmEnrichmentRetry({
      label: "contract_profile",
      address: candidate,
      maxAttempts: config.llmEnrichmentMaxAttempts,
      retryDelayMs: config.llmEnrichmentRetryDelayMs,
      logger
    }, () => tronClient.getContractIntelligenceProfile(candidate, { now, requireComplete: true })),
    upsertProfile: (profile) => upsertContractIntelligenceProfile(db, profile),
    logger
  }),
  getTransaction: (txHash) => tronClient.getTransaction(txHash),
  getUsdtRestrictionStatus: tronClient.getUsdtRestrictionStatus.bind(tronClient),
  listTrc20ApprovalChanges: (input) => tronClient.listTrc20ApprovalChanges(input),
  ensureAddressUsdtHistory,
  getAddressUsdtIndexState: (input) => getTronAddressUsdtIndexState(db, {
    address: input.address,
    coverageMode: input.coverageMode,
    targetTimestamp: input.targetTimestamp ?? null,
    requestKind: input.requestKind ?? "broad_targeted",
    windowStartTimestamp: input.windowStartTimestamp ?? null,
    windowEndTimestamp: input.windowEndTimestamp ?? null,
    candidateTxHash: input.candidateTxHash ?? null
  }),
  getCoveringAddressUsdtIndexState: (input) => getCoveringTronAddressUsdtIndexState(db, input),
  queueAddressUsdtHistory: (input) => queueTronAddressUsdtIndexState(db, {
    address: input.address,
    coverageMode: input.coverageMode,
    targetTimestamp: input.targetTimestamp ?? null,
    requestKind: input.requestKind ?? "broad_targeted",
    windowStartTimestamp: input.windowStartTimestamp ?? null,
    windowEndTimestamp: input.windowEndTimestamp ?? null,
    relatedHopTxHash: input.relatedHopTxHash ?? null,
    candidateTxHash: input.candidateTxHash ?? null,
    queuedReason: input.queuedReason,
    requestedByJobId: input.requestedByJobId ?? null,
    priority: input.queuedReason === "incoming_candidate_window" ? 240 : 250,
    nextRunAt: new Date(),
    budgetPages: input.budgetPages ??
      (input.coverageMode === "targeted" && input.queuedReason === "incoming_deposit_hop"
        ? TARGETED_HISTORY_BACKGROUND_MAX_PAGES
        : input.coverageMode === "targeted" && input.queuedReason === "incoming_candidate_window"
          ? 200
          : null),
    maxAttempts: input.coverageMode === "targeted" && input.queuedReason === "incoming_deposit_hop"
      ? input.maxAttempts ?? TARGETED_HISTORY_BACKGROUND_MAX_ATTEMPTS
      : input.coverageMode === "targeted" && input.queuedReason === "incoming_candidate_window"
        ? input.maxAttempts ?? 3
        : input.maxAttempts ?? null
  }),
  releaseForensicCheckJobToWaiting: (input) => releaseForensicCheckJobToWaiting(db, input),
  upsertForensicJobWait: (input) => upsertForensicJobWait(db, input),
  markWaitingForensicJobsReadyAfterTargetedIndex: (input) => markWaitingForensicJobsReadyAfterTargetedIndex(db, input),
  crossChainDiscoveryProvider,
  evmEvidenceProvider,
  crossChainContinuationProviders,
  crossChainStage2Enabled: config.crossChainStage2Enabled,
  crossChainMaxProviderCalls: config.crossChainStage2MaxProviderCalls
};

async function sendAdminAlert(message: string, options?: { parse_mode?: "HTML" }): Promise<void> {
  await sendServiceAdminAlert({
    adminIds: config.serviceAdminTelegramIds,
    message,
    options,
    sendMessage: async (telegramUserId, alertMessage, alertOptions) => {
      await bot.api.sendMessage(telegramUserId, alertMessage, alertOptions);
    },
    logger
  });
}

function forensicTelegramPayload(
  job: ForensicCheckJob,
  message: { text: string; parseMode: "HTML" }
): TelegramMessagePayloadV1 | null {
  if (!job.chatId) return null;
  return {
    version: "telegram-message-payload-v1",
    chatId: job.chatId,
    text: message.text,
    parseMode: message.parseMode,
    replyMarkup: null
  };
}

function buildForensicJobFailurePayload(
  job: ForensicCheckJob,
  error: string
): TelegramMessagePayloadV1 | null {
  const message = formatDeepForensicFailureUserDeliveryReport(job, error, null, {
    runtimeLabel: config.runtimeInstanceLabel,
    locale: normalizeBotLocale(job.progressJson.locale)
  });
  return forensicTelegramPayload(job, message);
}

function recoveredDeliveryPreparationError(
  code: "stale_intent_context_unavailable" | "stale_intent_payload_build_failed"
): Error & { code: typeof code } {
  return Object.assign(new Error(code), { code });
}

async function buildRecoveredForensicTelegramDelivery(input: {
  jobId: string;
  intent: { reasonCode: string };
}) {
  let job: ForensicCheckJob | null;
  try {
    job = await getForensicCheckJob(db, input.jobId);
  } catch {
    throw recoveredDeliveryPreparationError("stale_intent_context_unavailable");
  }
  if (!job || !job.chatId || job.kind === "address_fast_check") {
    throw recoveredDeliveryPreparationError("stale_intent_context_unavailable");
  }

  let whereJob: ForensicCheckJob | null = null;
  if (job.kind === "address_deep_check") {
    try {
      whereJob = await getLatestWhereIsMoneyCheckJobForAddress(db, {
        subjectAddress: job.subjectAddress,
        chatId: job.chatId,
        requestedBy: job.requestedBy,
        windowStart: job.windowStart,
        windowEnd: job.windowEnd
      });
    } catch {
      throw recoveredDeliveryPreparationError("stale_intent_context_unavailable");
    }
  }

  let payload: TelegramMessagePayloadV1 | null;
  try {
    const message = formatDeepForensicFailureUserDeliveryReport(
      job,
      input.intent.reasonCode,
      whereJob,
      {
        runtimeLabel: config.runtimeInstanceLabel,
        locale: normalizeBotLocale(job.progressJson.locale)
      }
    );
    payload = forensicTelegramPayload(job, message);
  } catch {
    throw recoveredDeliveryPreparationError("stale_intent_payload_build_failed");
  }
  if (!payload) {
    throw recoveredDeliveryPreparationError("stale_intent_context_unavailable");
  }

  let effect = null;
  if (job.kind === "incoming_deposit_check") {
    const watchedWalletId = job.progressJson.watchedWalletId;
    const incomingTxHash = job.progressJson.depositTxHash;
    if (typeof watchedWalletId !== "string" || typeof incomingTxHash !== "string") {
      throw recoveredDeliveryPreparationError("stale_intent_context_unavailable");
    }
    effect = {
      kind: "incoming_user_alert" as const,
      watchedWalletId,
      incomingTxHash
    };
  }

  return { kind: job.kind, payload, effect };
}

const forensicTelegramDeliveryRepository: ForensicTelegramDeliveryRepository<typeof db> = {
  listDueRecoveredForensicDeliveryIntents,
  settleRecoveredForensicDeliveryIntentPreparation,
  attachRecoveredForensicTelegramDelivery,
  claimNextForensicTelegramDelivery: (deliveryDb, input) =>
    claimNextForensicTelegramDelivery(deliveryDb, {
      ...input,
      resolveWalletDeliveryGeneration: async ({
        db: client,
        subjectAddress,
        chatId
      }) => {
        if (!ownsWalletDelivery(activeCheckGeneration, "unified")) {
          return { deliveryGeneration: "legacy" };
        }
        const ownership = await client.query(
          `select 1
             from unified_wallet_delivery_ownership
             where subject_address = $1
               and chat_id = $2
               and generation_id = $3
             limit 1`,
          [
            subjectAddress,
            chatId,
            activeCheckGeneration.generationId
          ]
        );
        return ownership.rows.length === 0
          ? { deliveryGeneration: "legacy" }
          : {
              deliveryGeneration: "unified",
              generationId: activeCheckGeneration.generationId
            };
      }
    }),
  settleForensicTelegramDelivery
};

const forensicTelegramDeliveryWork = createNonOverlappingStartupWork(
  () => runRecordedRuntimeCycle(
    "forensic_delivery",
    () => runSingleForensicTelegramDeliveryCycle({
      db,
      now: () => new Date(),
      repository: forensicTelegramDeliveryRepository,
      recoveryLimit: 10,
      deliveryLimit: 10,
      buildRecoveredTelegramDelivery: buildRecoveredForensicTelegramDelivery,
      sendTelegram: async (payload, signal) => {
        const options = {
          ...(payload.parseMode ? { parse_mode: payload.parseMode } : {}),
          ...(payload.replyMarkup ? { reply_markup: payload.replyMarkup } : {})
        } as Parameters<typeof bot.api.sendMessage>[2];
        const message = await bot.api.sendMessage(
          payload.chatId,
          payload.text,
          options,
          signal as Parameters<typeof bot.api.sendMessage>[3]
        );
        return { telegramMessageId: String(message.message_id) };
      },
      logger
    }),
    (result) => ({
      sourceQueryCompleted: true,
      examinedCount: result.claimProbeCount,
      completedCount: result.claimProbeCount
    })
  ).then(() => undefined),
  () => shuttingDown
);
const unifiedTelegramDeliveryWork = createNonOverlappingStartupWork(
  () => ownsWalletDelivery(activeCheckGeneration, "unified")
    ? runUnifiedDeliveryCycle({
    repository: createPostgresUnifiedDeliveryRepository(db),
    now: () => new Date(),
    leaseToken: randomUUID,
    leaseMs: 30_000,
    sendTimeoutMs: 25_000,
    limit: 10,
    sendTelegram: async (
      { chatId, messageThreadId, payload },
      signal
    ) => {
      const parsedThreadId = messageThreadId === ""
        ? undefined
        : Number(messageThreadId);
      if (
        parsedThreadId !== undefined &&
        (!Number.isSafeInteger(parsedThreadId) || parsedThreadId < 1)
      ) {
        return {
          kind: "rejected_permanent",
          code: "telegram_message_thread_id_invalid"
        };
      }
      const sent = await bot.api.sendMessage(chatId, payload.text, {
        parse_mode: payload.parseMode,
        ...(parsedThreadId === undefined
          ? {}
          : { message_thread_id: parsedThreadId })
      }, signal as Parameters<typeof bot.api.sendMessage>[3]);
      return {
        kind: "confirmed",
        telegramMessageId: String(sent.message_id)
      };
    }
      }).then((summary) => {
        if (summary.claimed > 0) {
          logger.info("unified_delivery_cycle_completed", summary);
        }
      })
    : Promise.resolve(),
  () => shuttingDown
);

const approvalAllowanceRefreshWork = createNonOverlappingStartupWork(
  () => runRecordedRuntimeCycle(
    "allowance_refresh",
    () => runSingleApprovalAllowanceRefreshCycle({
      db,
      now: () => new Date(),
      getUsdtAllowance: getBackgroundUsdtAllowance,
      saveWalletApprovalAllowanceStateV2: (input) => saveWalletApprovalAllowanceStateV2(db, input),
      repository: {
        listDueApprovalAllowanceRefreshTargets,
        tryAcquireApprovalAllowanceRefreshLock
      }
    }),
    (result) => ({
      sourceQueryCompleted: true,
      examinedCount: result.selected,
      completedCount: result.completed
    })
  ).then(() => undefined),
  () => shuttingDown
);

async function pollOnce(): Promise<void> {
  void approvalAllowanceRefreshWork.run().catch((error) => {
    logger.error("approval_allowance_refresh_cycle_failed", {
      error: error instanceof Error ? error.message : String(error)
    });
  });
  if (activePoll) return activePoll;

  activePoll = runRecordedRuntimeCycle("poll", async () => {
    const wallets = await listWatchedWallets(db);
    await runSinglePollingCycle({
      wallets,
      tronClient,
      pageLimit: config.tronscanPageLimit,
      maxPagesPerWallet: config.tronscanMaxPagesPerWallet,
      backfillLookbackMs: config.tronscanBackfillLookbackMs,
      incomingDepositRealtimeMaxAgeMs: config.incomingDepositRealtimeMaxAgeMs,
      addressPoisoningSmallTransferMaxRaw,
      isWatchedWalletActive: (watchedWalletId) => watchedWalletExists(db, watchedWalletId),
      getWalletPollState: (watchedWalletId) => getWalletPollState(db, watchedWalletId),
      upsertWalletPollState: (input) => upsertWalletPollState(db, input),
      claimObservedTransactionForUserAlert: (input) => claimObservedTransactionForUserAlert(db, input),
      claimUserAlertsForRetry: (input) => claimUserAlertsForRetry(db, input),
      claimDigestTransactions: (input) => claimDigestTransactions(db, input),
      recordObservedTransactionRisk: (input) => recordObservedTransactionRisk(db, input),
      queueIncomingDepositJob: async (input) => {
        const windowEnd = new Date(input.timestamp.getTime() + 60_000);
        const windowStart = new Date(input.timestamp.getTime() - 30 * 24 * 60 * 60 * 1000);
        const job = await createOrReuseForensicCheckJob(db, {
          kind: "incoming_deposit_check",
          subjectAddress: input.sender,
          windowStart,
          windowEnd,
          chatId: input.chatId,
          requestedBy: input.requestedBy,
          priority: 140,
          progressJson: {
            depositTxHash: input.txHash,
            watchedWalletId: input.watchedWalletId,
            watchedWallet: input.watchedWallet,
            sender: input.sender,
            amount: input.amount,
            amountRaw: input.amountRaw,
            timestamp: input.timestamp.toISOString(),
            telegramUserId: input.telegramUserId,
            alertMode: input.alertMode,
            locale: input.locale ?? null
          }
        });
        return { id: job.id };
      },
      markUserAlertAnalyzing: (input) => markUserAlertAnalyzing(db, input),
      markUserAlertSent: (input) => markUserAlertSent(db, input),
      markUserAlertSkipped: (input) => markUserAlertSkipped(db, input),
      markUserAlertFailed: (input) => markUserAlertFailed(db, input),
      markDigestSent: (input) => markDigestSent(db, input),
      getLabelsForAddress: (address) => listAddressLabels(db, address),
      recordRiskEvaluation: (evaluation) => saveRiskEvaluationEvidence(db, evaluation),
      listCustomerAlertRecipients: (ownerTelegramUserId) => listCustomerAlertRecipients(db, ownerTelegramUserId),
      sendUserAlert: async (telegramUserId, message, options) => {
        await bot.api.sendMessage(telegramUserId, message, options);
      },
      sendCustomerAdminAlert: async (telegramUserId, message, options) => {
        await bot.api.sendMessage(telegramUserId, message, options);
      },
      sendDigestAlert: async (telegramUserId, message, options) => {
        await bot.api.sendMessage(telegramUserId, message, options);
      },
      sendAdminAlert,
      logger
    });
    await runSingleApprovalPollingCycle({
      wallets,
      tronClient,
      pageLimit: config.tronscanPageLimit,
      maxPagesPerWallet: config.tronscanMaxPagesPerWallet,
      isWatchedWalletActive: (watchedWalletId) => watchedWalletExists(db, watchedWalletId),
      getApprovalPollState: (watchedWalletId) => getApprovalPollState(db, watchedWalletId),
      recordApprovalPollSuccess: (input) => recordApprovalPollSuccess(db, input),
      recordApprovalPollFailure: (input) => recordApprovalPollFailure(db, input),
      upsertWalletApproval: (input) => upsertWalletApproval(db, input),
      claimObservedApprovalEvent: (input) => claimObservedApprovalEvent(db, input),
      getUsdtAllowance: (input) => tronClient.getUsdtAllowance(input),
      getApprovalPresentationBalance: ({ ownerAddress, signal }) => tronClient.getUsdtBalance(ownerAddress, {
        signal,
        timeoutMs: 2_000,
        retryAttempts: 0
      }),
      saveWalletApprovalAllowanceStateV2: (input) => saveWalletApprovalAllowanceStateV2(db, input),
      claimObservedApprovalDrainEvent: (input) => claimObservedApprovalDrainEvent(db, input),
      recordApprovalRisk: (input) => recordApprovalRisk(db, input),
      markApprovalContextPending: (input) => markApprovalContextPending(db, input),
      markApprovalOwnerAlertSent: (input) => markApprovalOwnerAlertSent(db, input),
      markApprovalOwnerAlertSkipped: (input) => markApprovalOwnerAlertSkipped(db, input),
      markApprovalOwnerAlertFailed: (input) => markApprovalOwnerAlertFailed(db, input),
      getLabelsForAddress: (address) => listAddressLabels(db, address),
      getAddressMetadata: (address, now) => getAddressMetadata(db, address, now),
      upsertAddressMetadata: (input) => upsertAddressMetadata(db, input),
      getContractIntelligenceProfile: (address, now) => getContractIntelligenceProfile(db, address, now),
      upsertContractIntelligenceProfile: (input) => upsertContractIntelligenceProfile(db, input),
      recordRiskEvaluation: (evaluation) => saveRiskEvaluationEvidence(db, evaluation),
      listCustomerAlertRecipients: (ownerTelegramUserId) => listCustomerAlertRecipients(db, ownerTelegramUserId),
      sendUserAlert: async (telegramUserId, message, options) => {
        await bot.api.sendMessage(telegramUserId, message, options);
      },
      sendCustomerAdminAlert: async (telegramUserId, message, options) => {
        await bot.api.sendMessage(telegramUserId, message, options);
      },
      sendAdminAlert,
      logger
    });
    await runSingleApprovalContextFinalizerCycle({
      tronClient,
      pageLimit: config.tronscanPageLimit,
      maxPagesPerWallet: config.tronscanMaxPagesPerWallet,
      claimDueApprovalContexts: (input) => claimDueApprovalContexts(db, input),
      markApprovalContextResolved: (input) => markApprovalContextResolved(db, input),
      markApprovalContextExpired: (input) => markApprovalContextExpired(db, input),
      markApprovalContextFinalAlertSent: (input) => markApprovalContextFinalAlertSent(db, input),
      releaseApprovalContextAfterFailure: (input) => releaseApprovalContextAfterFailure(db, input),
      getUsdtAllowance: (input) => tronClient.getUsdtAllowance(input),
      getApprovalPresentationBalance: ({ ownerAddress, signal }) => tronClient.getUsdtBalance(ownerAddress, {
        signal,
        timeoutMs: 2_000,
        retryAttempts: 0
      }),
      saveWalletApprovalAllowanceStateV2: (input) => saveWalletApprovalAllowanceStateV2(db, input),
      upsertWalletApproval: (input) => upsertWalletApproval(db, input),
      recordApprovalRisk: (input) => recordApprovalRisk(db, input),
      getLabelsForAddress: (address) => listAddressLabels(db, address),
      getAddressMetadata: (address, now) => getAddressMetadata(db, address, now),
      upsertAddressMetadata: (input) => upsertAddressMetadata(db, input),
      getContractIntelligenceProfile: (address, now) => getContractIntelligenceProfile(db, address, now),
      upsertContractIntelligenceProfile: (input) => upsertContractIntelligenceProfile(db, input),
      recordRiskEvaluation: (evaluation) => saveRiskEvaluationEvidence(db, evaluation),
      listCustomerAlertRecipients: (ownerTelegramUserId) => listCustomerAlertRecipients(db, ownerTelegramUserId),
      sendUserAlert: async (telegramUserId, message, options) => {
        await bot.api.sendMessage(telegramUserId, message, options);
      },
      sendCustomerAdminAlert: async (telegramUserId, message, options) => {
        await bot.api.sendMessage(telegramUserId, message, options);
      },
      sendAdminAlert,
      logger
    });
    return wallets.length;
  }, (walletCount) => ({
    sourceQueryCompleted: true,
    examinedCount: walletCount,
    completedCount: walletCount
  })).then(() => undefined).finally(() => {
    activePoll = null;
  });

  return activePoll;
}

async function recoverStaleForensicJobsOnce(): Promise<void> {
  const recoveredAt = new Date();
  const result = await recoverStaleForensicCheckJobs(db, {
    staleRunningBefore: new Date(recoveredAt.getTime() - config.forensicJobStaleAfterMs),
    recoveredAt,
    maxRetries: config.forensicJobMaxRetries
  });
  for (const job of result.requeued) {
    logger.warn("forensic_job_stale_requeued", {
      job_id: job.id,
      kind: job.kind,
      subject_address: job.subjectAddress,
      retry_count: job.progressJson.retryCount,
      reason: job.progressJson.staleRecoveryReason
    });
  }
  for (const job of result.failed) {
    logger.warn("forensic_job_stale_failed", {
      job_id: job.id,
      kind: job.kind,
      subject_address: job.subjectAddress,
      retry_count: job.progressJson.retryCount,
      reason: job.progressJson.staleRecoveryReason
    });
  }
}

async function refreshDeepCheckSecondLayerJob(jobId: string) {
  return refreshDeepCheckSecondLayerFromIndex({
    jobId,
    getJob: (id) => getForensicCheckJob(db, id),
    saveCompletedDeepSecondLayerContext: (input) => saveCompletedDeepSecondLayerContext(db, input),
    getClassificationForAddress: async (address) => {
      const metadata = await getCachedOrLiveAddressMetadata(address);
      const contractProfile = metadata?.isContract === true
        ? await getCachedOrLiveContractIntelligenceProfile(address)
        : null;
      return classifyServiceAddress({ address, metadata, contractProfile });
    },
    getIndexState: (address) => getTronAddressUsdtIndexState(db, {
      address,
      coverageMode: "all_time",
      targetTimestamp: null
    }),
    listIndexedEdges: async (address) => {
      const transfers = await listIndexedTronUsdtTransfersForAddress(db, {
        address,
        minTimestamp: new Date(0),
        maxTimestamp: new Date(),
        limit: 500,
        orderBy: "amount_desc",
        direction: "both"
      });
      return transfers.map(indexedTransferToRouteEdge);
    }
  });
}

async function refreshDeepCheckSecondLayerOnce(limit = 5): Promise<number> {
  const jobs = await listCompletedDeepCheckJobsWithPendingSecondLayer(db, { limit });
  let refreshed = 0;

  for (const job of jobs) {
    try {
      const result = await refreshDeepCheckSecondLayerJob(job.id);
      if (result.status === "refreshed") refreshed += 1;
    } catch (error) {
      logger.warn("deep_second_layer_refresh_failed", {
        job_id: job.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return refreshed;
}

async function indexWalletIntelligenceCompletedJob(input: {
  job: ForensicCheckJob;
  progressJson: Record<string, unknown>;
  resultJson: Record<string, unknown>;
  status: "completed" | "partial";
}): Promise<void> {
  const completedJob: ForensicCheckJob = {
    ...input.job,
    status: input.status,
    progressJson: input.progressJson,
    resultJson: input.resultJson,
    completedAt: input.job.completedAt ?? new Date(),
    updatedAt: new Date()
  };
  const extracted = extractWalletIntelligenceFromJob(completedJob);
  const profile = completedJob.requestedBy
    ? await getTelegramUserProfile(db, completedJob.requestedBy).catch(() => null)
    : null;
  await indexWalletIntelligenceJobPayload(db, {
    ...extracted,
    run: {
      ...extracted.run,
      telegramUserId: profile?.telegramUserId ?? completedJob.requestedBy,
      telegramUsername: profile?.username ?? null,
      telegramLocale: profile?.locale ?? null
    }
  });
}

async function runForensicJobsOnce(kinds: ForensicCheckJobKind[], maxJobs: number): Promise<number> {
  await recoverStaleForensicJobsOnce();
  const processed = await runForensicJobBatch({
    maxJobs,
    runSingleCycle: () => runSingleDeepForensicJobCycle({
      tronClient,
      claimNextForensicCheckJob: () => claimNextForensicCheckJob(db, { kinds }),
      completeForensicCheckJob: (input) => completeForensicCheckJob(db, input),
      indexWalletIntelligenceJob: indexWalletIntelligenceCompletedJob,
      updateForensicCheckJobProgress: (input) => updateForensicCheckJobProgress(db, input),
      releaseForensicCheckJobToWaiting: (input) => releaseForensicCheckJobToWaiting(db, input),
      recordRiskEvaluation: (evaluation) => saveRiskEvaluationEvidence(db, evaluation),
      upsertAddressLabelAssertion: (input) => upsertAddressLabelAssertion(db, input),
      getLabelsForAddress: (address) => listAddressLabels(db, address),
      getAddressMetadata: (address) => getCachedOrLiveAddressMetadata(address),
      getContractIntelligenceProfile: (address) => getCachedOrLiveContractIntelligenceProfile(address),
      getUsdtRestrictionStatus: tronClient.getUsdtRestrictionStatus.bind(tronClient),
      getTransaction: (txHash) => tronClient.getTransaction(txHash),
      listTrc20ApprovalChanges: (input) => tronClient.listTrc20ApprovalChanges(input),
      crossChainDiscoveryProvider,
      evmEvidenceProvider,
      crossChainContinuationProviders,
      listIndexedUsdtTransfersForAddress: (address, options) => listIndexedTronUsdtTransfersForAddress(db, {
        address,
        minTimestamp: options.minTimestamp,
        maxTimestamp: options.maxTimestamp,
        limit: options.limit,
        offset: options.offset,
        orderBy: options.orderBy,
        direction: "both"
      }),
      getAddressUsdtIndexState: (input) => getTronAddressUsdtIndexState(db, input),
      getCoveringAddressUsdtIndexState: (input) => getCoveringTronAddressUsdtIndexState(db, input),
      ensureAddressUsdtHistory,
      upsertForensicJobWait: (input) => upsertForensicJobWait(db, input),
      markWaitingForensicJobsReadyAfterTargetedIndex: (input) => markWaitingForensicJobsReadyAfterTargetedIndex(db, input),
      queueAddressUsdtHistory: (input) => {
        const requestInput = input as typeof input & {
          requestKind?: TronAddressUsdtIndexRequestKind | null;
          windowStartTimestamp?: Date | null;
          windowEndTimestamp?: Date | null;
          relatedHopTxHash?: string | null;
          candidateTxHash?: string | null;
        };
        return queueTronAddressUsdtIndexState(db, {
          address: requestInput.address,
          coverageMode: requestInput.coverageMode,
          targetTimestamp: requestInput.targetTimestamp ?? null,
          requestKind: requestInput.requestKind ?? "broad_targeted",
          windowStartTimestamp: requestInput.windowStartTimestamp ?? null,
          windowEndTimestamp: requestInput.windowEndTimestamp ?? null,
          relatedHopTxHash: requestInput.relatedHopTxHash ?? null,
          candidateTxHash: requestInput.candidateTxHash ?? null,
          queuedReason: requestInput.queuedReason,
          requestedByJobId: requestInput.requestedByJobId ?? null,
          priority: requestInput.queuedReason === "where_is_money_hop"
            ? 250
            : requestInput.queuedReason === "where_candidate_window"
              ? 240
              : requestInput.queuedReason === "deep_subject"
                ? 100
                : 10,
          nextRunAt: new Date(),
          budgetPages: requestInput.budgetPages ??
            (requestInput.coverageMode === "targeted" && requestInput.queuedReason === "where_is_money_hop"
              ? TARGETED_HISTORY_BACKGROUND_MAX_PAGES
              : requestInput.coverageMode === "targeted" && requestInput.queuedReason === "where_candidate_window"
                ? 200
                : null),
          maxAttempts: requestInput.coverageMode === "targeted" && requestInput.queuedReason === "where_is_money_hop"
            ? requestInput.maxAttempts ?? TARGETED_HISTORY_BACKGROUND_MAX_ATTEMPTS
            : requestInput.coverageMode === "targeted" && requestInput.queuedReason === "where_candidate_window"
              ? requestInput.maxAttempts ?? 3
              : requestInput.maxAttempts ?? null,
          allowRunningRequeue: requestInput.allowRunningRequeue === true
        });
      },
      buildJobResultPayload: async (job, report, status) => {
        if (!job.chatId) return null;
        const locale = normalizeBotLocale(job.progressJson.locale);
        const whereJob = await getLatestWhereIsMoneyCheckJobForAddress(db, {
          subjectAddress: job.subjectAddress,
          chatId: job.chatId,
          requestedBy: job.requestedBy,
          windowStart: job.windowStart,
          windowEnd: job.windowEnd
        });
        const message = formatDeepForensicUserDeliveryReport(job, report, status, whereJob, {
          runtimeLabel: config.runtimeInstanceLabel,
          locale,
          showBetaDiagnostics: config.botBetaRiskDiagnosticsEnabled
        });
        return forensicTelegramPayload(job, message);
      },
      buildWhereIsMoneyJobResultPayload: async (job, report, status) => {
        if (!job.chatId) return null;
        const deepJob = await getLatestDeepForensicCheckJobForAddressAnyStatus(db, {
          subjectAddress: job.subjectAddress,
          chatId: job.chatId,
          requestedBy: job.requestedBy,
          windowStart: job.windowStart,
          windowEnd: job.windowEnd
        });
        const message = formatWhereIsMoneyUserDeliveryReport(job, report, status, deepJob, {
          runtimeLabel: config.runtimeInstanceLabel,
          locale: normalizeBotLocale(job.progressJson.locale),
          showBetaDiagnostics: config.botBetaRiskDiagnosticsEnabled,
          onPreliminaryDiagnostic: (diagnostic) => {
            logger.warn("where_preliminary_score_without_structured_fact", diagnostic);
          }
        });
        return forensicTelegramPayload(job, message);
      },
      buildJobFailurePayload: buildForensicJobFailurePayload,
      buildWhereIsMoneyJobFailurePayload: buildForensicJobFailurePayload
    }, {
      ...deepForensicRuntimeOptions(config, tronscanScheduler.diagnostics().apiKeyConfigured),
      targetedHistoryMaxBudgetPages: TARGETED_HISTORY_BACKGROUND_MAX_PAGES_PER_HOP
    })
  });
  return processed;
}

async function whereForensicOnce(): Promise<void> {
  const deliveryCycle = forensicTelegramDeliveryWork.run();
  void deliveryCycle.catch(() => {
    logger.error("forensic_telegram_delivery_cycle_failed", {
      diagnosticCode: "forensic_telegram_delivery_cycle_failed"
    });
  });
  if (activeWhereForensicPoll) return activeWhereForensicPoll;
  activeWhereForensicPoll = runRecordedRuntimeCycle(
    "wait_reconciliation",
    () => forensicRuntimeOrchestration.runBeforeWherePoll(),
    (summary) => summary
  )
    .then(() => runRecordedRuntimeCycle(
      "where_forensic",
      () => runForensicJobsOnce(["where_is_money_check"], config.forensicWhereJobsPerPoll),
      (handled) => ({ sourceQueryCompleted: true, examinedCount: handled, completedCount: handled })
    ))
    .then((handled) => {
      if (handled > 0) logger.info("where_forensic_jobs_processed", { handled });
    })
    .finally(() => {
      activeWhereForensicPoll = null;
    });
  return activeWhereForensicPoll;
}

async function addressIndexOnce(): Promise<void> {
  if (activeAddressIndexPoll) return activeAddressIndexPoll;
  const isCandidateWindowReason = (reason: string): boolean =>
    reason === "where_candidate_window" || reason === "incoming_candidate_window";
  activeAddressIndexPoll = runRecordedRuntimeCycle("address_index", () => runAddressIndexWorkerOnce({
    claimQueuedTronAddressUsdtIndexStates: (input) => claimQueuedTronAddressUsdtIndexStates(db, input),
    ensureAddressUsdtHistory,
    queueAddressUsdtHistory: (input) => queueTronAddressUsdtIndexState(db, {
      address: input.address,
      coverageMode: input.coverageMode,
      targetTimestamp: input.targetTimestamp ?? null,
      requestKind: input.requestKind ?? "broad_targeted",
      windowStartTimestamp: input.windowStartTimestamp ?? null,
      windowEndTimestamp: input.windowEndTimestamp ?? null,
      relatedHopTxHash: input.relatedHopTxHash ?? null,
      candidateTxHash: input.candidateTxHash ?? null,
      queuedReason: input.queuedReason,
      requestedByJobId: input.requestedByJobId ?? null,
      priority: input.priority ?? (isCandidateWindowReason(input.queuedReason) ? 240 : 250),
      nextRunAt: input.nextRunAt ?? new Date(),
      budgetPages: input.budgetPages ?? (isCandidateWindowReason(input.queuedReason) ? 200 : null),
      maxAttempts: input.maxAttempts ?? (isCandidateWindowReason(input.queuedReason) ? 3 : null),
      allowRunningRequeue: input.allowRunningRequeue === true
    }),
    failTronAddressUsdtIndexState: (input) => failTronAddressUsdtIndexState(db, input),
    markWaitingForensicJobsReadyAfterTargetedIndex: (input) => markWaitingForensicJobsReadyAfterTargetedIndex(db, input),
    reconcileWaitingForensicJobs: async () => {
      await runRecordedRuntimeCycle(
        "wait_reconciliation",
        () => forensicRuntimeOrchestration.runAfterTargetedIndexCompletion(),
        (summary) => summary
      );
    },
    onWaitReconciliationError: () => logger.warn("forensic_wait_reconciliation_failed", {
      diagnosticCode: "wait_reconciliation_failed"
    }),
    patchWaitingForensicJobsTargetedIndexProgress: (input) => patchWaitingForensicJobsTargetedIndexProgress(db, input),
    markStrictProvenanceJobReadyAfterIndex: (input) => markStrictProvenanceJobReadyAfterIndex(db, input)
  }, {
    claimLimit: config.tronAddressIndexClaimLimit ?? 3,
    lockMs: config.tronAddressIndexLockMs ?? 600_000,
    workerId: process.env.HOSTNAME ?? `pid-${process.pid}`,
    targetedRetry: {
      basePages: TARGETED_HISTORY_BACKGROUND_MAX_PAGES,
      maxPagesPerHop: TARGETED_HISTORY_BACKGROUND_MAX_PAGES_PER_HOP,
      maxWindowSplitDepth: TARGETED_HISTORY_BACKGROUND_MAX_WINDOW_SPLIT_DEPTH,
      escalationFactor: TARGETED_HISTORY_BACKGROUND_ESCALATION_FACTOR,
      maxAttempts: TARGETED_HISTORY_BACKGROUND_MAX_ATTEMPTS,
      retryDelayMs: 30_000
    }
  }), (summary) => ({
    sourceQueryCompleted: true,
    examinedCount: summary.claimed,
    completedCount: summary.completed + summary.requeued + summary.failed
  }))
    .then(() => undefined)
    .finally(() => {
      activeAddressIndexPoll = null;
    });
  return activeAddressIndexPoll;
}

async function deepForensicOnce(): Promise<void> {
  if (activeDeepForensicPoll) return activeDeepForensicPoll;
  void addressIndexOnce().catch((error) => {
    logger.warn("deep_forensic_address_index_kick_failed", {
      error: error instanceof Error ? error.message : String(error)
    });
  });
  activeDeepForensicPoll = runRecordedRuntimeCycle(
    "deep_forensic",
    () => runForensicJobsOnce(["address_deep_check"], 1),
    (handled) => ({ sourceQueryCompleted: true, examinedCount: handled, completedCount: handled })
  )
    .then((handled) => {
      void refreshDeepCheckSecondLayerOnce().catch((error) => {
        logger.warn("deep_second_layer_refresh_failed", {
          error: error instanceof Error ? error.message : String(error)
        });
      });
      return handled;
    })
    .then((handled) => {
      if (handled > 0) logger.info("deep_forensic_jobs_processed", { handled });
    })
    .finally(() => {
      activeDeepForensicPoll = null;
    });
  return activeDeepForensicPoll;
}

async function incomingDepositOnce(): Promise<void> {
  if (activeIncomingDepositPoll) return activeIncomingDepositPoll;
  activeIncomingDepositPoll = (async () => {
    await runRecordedRuntimeCycle(
      "wait_reconciliation",
      () => forensicRuntimeOrchestration.runBeforeIncomingPoll(),
      (summary) => summary
    );
    await recoverStaleForensicJobsOnce();
    return runRecordedRuntimeCycle(
      "incoming_deposit",
      () => runForensicJobBatch({
        maxJobs: config.forensicIncomingJobsPerPoll,
        runSingleCycle: () => runSingleIncomingDepositJobCycle({
        claimNextForensicCheckJob: () => claimNextForensicCheckJob(db, { kinds: ["incoming_deposit_check"] }),
        completeForensicCheckJob: (input) => completeForensicCheckJob(db, input),
        indexWalletIntelligenceJob: indexWalletIntelligenceCompletedJob,
        updateForensicCheckJobProgress: (input) => updateForensicCheckJobProgress(db, input),
        markUserAlertSent: (input) => markUserAlertSent(db, input),
        markUserAlertFailed: (input) => markUserAlertFailed(db, input),
        recordObservedTransactionRisk: (input) => recordObservedTransactionRisk(db, input),
        hasUndismissedAddressPoisoningCandidateForIncoming: (input) =>
          hasUndismissedAddressPoisoningCandidateForIncoming(db, {
            watchedWalletId: input.watchedWalletId,
            txHash: input.incomingTxHash
          }),
        buildJobFailurePayload: buildForensicJobFailurePayload,
        formatIncomingDepositRiskAlert,
        buildReport: (input) => buildIncomingDepositReport({
          ...input,
          deps: incomingDepositRuntimeDeps
        })
        })
      }),
      (handled) => ({ sourceQueryCompleted: true, examinedCount: handled, completedCount: handled })
    );
  })()
    .then((handled) => {
      if (handled > 0) logger.info("incoming_deposit_jobs_processed", { handled });
    })
    .finally(() => {
      activeIncomingDepositPoll = null;
    });
  return activeIncomingDepositPoll;
}

const addressPoisoningWorkerDeps: AddressPoisoningWorkerDeps = {
  db,
  repository: addressPoisoningWorkerRepository,
  tronClient: addressPoisoningTronClient,
  realtimeMaxAgeMs: config.incomingDepositRealtimeMaxAgeMs,
  sendUserAlert: async (telegramUserId, message, options) => {
    const { signal, ...telegramOptions } = options;
    return bot.api.sendMessage(
      telegramUserId,
      message,
      telegramOptions,
      signal as Parameters<typeof bot.api.sendMessage>[3]
    );
  },
  logger
};
const addressPoisoningCheckWork = createNonOverlappingStartupWork(
  () => runSingleAddressPoisoningCheckCycle(addressPoisoningWorkerDeps).then(() => undefined),
  () => shuttingDown
);
const addressPoisoningDeliveryWork = createNonOverlappingStartupWork(
  () => runSingleAddressPoisoningAlertDeliveryCycle(addressPoisoningWorkerDeps).then(() => undefined),
  () => shuttingDown
);
const addressPoisoningOnce = () => Promise.all([
  addressPoisoningCheckWork.run(),
  addressPoisoningDeliveryWork.run()
]).then(() => undefined);

const startupWork: Record<StartupWorkLabel, () => Promise<void>> = {
  poll: pollOnce,
  where_forensic: whereForensicOnce,
  incoming_deposit: incomingDepositOnce,
  deep_forensic: deepForensicOnce,
  address_index: addressIndexOnce,
  address_poisoning: addressPoisoningOnce
};

const intervalByLabel: Record<StartupWorkLabel, number> = {
  poll: config.pollIntervalMs,
  where_forensic: config.forensicWherePollIntervalMs,
  incoming_deposit: config.forensicIncomingPollIntervalMs,
  deep_forensic: config.forensicDeepPollIntervalMs,
  address_index: config.tronAddressIndexPollIntervalMs ?? 15_000,
  address_poisoning: ADDRESS_POISONING_INTERVAL_MS
};

let startupWorkSchedule: StartupWorkScheduleController | null = null;
let unifiedWorkSchedule: StartupWorkScheduleController | null = null;
const startupWorkScheduleItems = buildStartupWorkSchedule(config);

function startBackgroundWorkSchedule(): void {
  if (startupWorkSchedule) return;
  startupWorkSchedule = startStartupWorkSchedule({
    schedule: startupWorkScheduleItems,
    startupWork,
    intervalByLabel,
    initialErrorEventByLabel: {
      poll: "initial_polling_cycle_failed",
      where_forensic: "initial_where_forensic_cycle_failed",
      incoming_deposit: "initial_incoming_deposit_cycle_failed",
      deep_forensic: "initial_deep_forensic_cycle_failed",
      address_index: "initial_address_index_cycle_failed",
      address_poisoning: "initial_address_poisoning_cycle_failed"
    },
    intervalErrorEventByLabel: {
      poll: "polling_cycle_failed",
      where_forensic: "where_forensic_cycle_failed",
      incoming_deposit: "incoming_deposit_worker_failed",
      deep_forensic: "deep_forensic_cycle_failed",
      address_index: "address_index_cycle_failed",
      address_poisoning: "address_poisoning_cycle_failed"
    },
    onError: (eventName, error) => {
      logger.error(eventName, { error: error instanceof Error ? error.message : String(error) });
    }
  });
  const unifiedProviderWork = async () => {
    unifiedProviderPool.wake();
  };
  const unifiedAnalysisWork = () =>
    unifiedProductionRuntime.runAnalysisCycle().then(() => undefined);
  const unifiedFinalizationWork = () =>
    unifiedProductionRuntime.runFinalizationCycle().then((result) => {
      if (result.finalized) {
        logger.info("unified_wallet_check_finalized", {
          runId: result.runId
        });
      }
    });
  const unifiedWatchdogWork = () =>
    listUnifiedWatchdogRuns(unifiedTransactionHost, { limit: 100 })
      .then((runs) => {
        const projections = inspectUnifiedRuns(runs, {
          now: new Date(),
          staleHeartbeatMs: Math.max(
            60_000,
            config.forensicIncomingPollIntervalMs * 3
          )
        });
        const actionable = projections.filter((run) =>
          run.finding !== "healthy"
        );
        if (actionable.length > 0) {
          logger.warn("unified_watchdog_findings", {
            runs: actionable.map((run) => ({
              runId: run.id,
              finding: run.finding
            }))
          });
        }
      });
  const unifiedWork: Record<UnifiedResourceWorkLabel, () => Promise<void>> = {
    unified_provider_io: unifiedProviderWork,
    unified_indexing: unifiedProviderWork,
    unified_cpu_aggregation: unifiedAnalysisWork,
    unified_scoring_rendering: unifiedFinalizationWork,
    unified_delivery: unifiedTelegramDeliveryWork.run,
    unified_watchdog: unifiedWatchdogWork
  };
  unifiedWorkSchedule = startUnifiedResourceWorkSchedule({
    schedule: selectUnifiedStartupSchedule(
      activeCheckGeneration,
      buildUnifiedResourceWorkSchedule()
    ),
    startupWork: unifiedWork,
    intervalByLabel: Object.fromEntries(
      Object.keys(unifiedWork).map((label) => [
        label,
        config.forensicIncomingPollIntervalMs
      ])
    ) as Record<UnifiedResourceWorkLabel, number>,
    onError: (eventName, error) => {
      logger.error(eventName, {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
  logger.info("startup_work_schedule_started", { schedule: startupWorkScheduleItems });
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("shutdown_started", { signal });
  startupWorkSchedule?.stop();
  startupWorkSchedule = null;
  unifiedWorkSchedule?.stop();
  unifiedWorkSchedule = null;
  await unifiedProviderPool.stop();

  if (activePoll) {
    try {
      await activePoll;
    } catch (error) {
      logger.error("active_poll_shutdown_wait_failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  if (activeWhereForensicPoll) {
    try {
      await activeWhereForensicPoll;
    } catch (error) {
      logger.error("active_where_forensic_shutdown_wait_failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  if (activeDeepForensicPoll) {
    try {
      await activeDeepForensicPoll;
    } catch (error) {
      logger.error("active_deep_forensic_shutdown_wait_failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  if (activeIncomingDepositPoll) {
    try {
      await activeIncomingDepositPoll;
    } catch (error) {
      logger.error("active_incoming_deposit_shutdown_wait_failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  if (activeAddressIndexPoll) {
    try {
      await activeAddressIndexPoll;
    } catch (error) {
      logger.error("active_address_index_shutdown_wait_failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  const activeForensicTelegramDelivery = forensicTelegramDeliveryWork.active();
  if (activeForensicTelegramDelivery) {
    try {
      await activeForensicTelegramDelivery;
    } catch {
      logger.error("active_forensic_telegram_delivery_shutdown_wait_failed", {
        diagnosticCode: "forensic_telegram_delivery_shutdown_wait_failed"
      });
    }
  }
  const activeUnifiedTelegramDelivery = unifiedTelegramDeliveryWork.active();
  if (activeUnifiedTelegramDelivery) {
    try {
      await activeUnifiedTelegramDelivery;
    } catch {
      logger.error("active_unified_telegram_delivery_shutdown_wait_failed", {
        diagnosticCode: "unified_telegram_delivery_shutdown_wait_failed"
      });
    }
  }

  const activeApprovalAllowanceRefresh = approvalAllowanceRefreshWork.active();
  if (activeApprovalAllowanceRefresh) {
    try {
      await activeApprovalAllowanceRefresh;
    } catch (error) {
      logger.error("active_approval_allowance_refresh_shutdown_wait_failed", {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const activeAddressPoisoningCheck = addressPoisoningCheckWork.active();
  const activeAddressPoisoningDelivery = addressPoisoningDeliveryWork.active();
  if (activeAddressPoisoningCheck) {
    try {
      await activeAddressPoisoningCheck;
    } catch (error) {
      logger.error("active_address_poisoning_check_shutdown_wait_failed", {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  if (activeAddressPoisoningDelivery) {
    try {
      await activeAddressPoisoningDelivery;
    } catch (error) {
      logger.error("active_address_poisoning_delivery_shutdown_wait_failed", {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  try {
    await bot.stop();
  } catch (error) {
    logger.error("bot_shutdown_failed", { error: error instanceof Error ? error.message : String(error) });
  }

  if (adminDashboard) {
    try {
      await adminDashboard.close();
      logger.info("admin_dashboard_stopped", {});
    } catch (error) {
      logger.error("admin_dashboard_shutdown_failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  try {
    await closeDb(db);
  } catch (error) {
    logger.error("database_shutdown_failed", { error: error instanceof Error ? error.message : String(error) });
  }
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

startBackgroundWorkSchedule();

bot.start({
  onStart: () => {
    logger.info("bot_started");
    startBackgroundWorkSchedule();
  }
}).catch((error) => {
  logger.error("telegram_bot_failed", { error: error instanceof Error ? error.message : String(error) });
  void shutdown("SIGTERM").then(() => {
    process.exitCode = 1;
  });
});
