import { randomUUID } from "node:crypto";
import { freemem } from "node:os";
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
import { createSelectiveTransactionEnricher } from "./forensics/selectiveTransactionEnrichment";
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
  SCHEMA_032_FILENAME,
  SCHEMA_033_FILENAME,
  SCHEMA_034_FILENAME,
  SCHEMA_035_FILENAME,
  SCHEMA_036_FILENAME,
  SCHEMA_036_VERSION,
  checksumMigrationBytes,
  verifyRequiredSchema036,
  type Schema036Verification
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
  listFreshTaggedAddressMetadataAt,
  getForensicCheckJob,
  getTransactionProviderEvidence,
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
  listActiveAddressLabelAssertionsForRoute,
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
  saveTransactionEnrichmentDecisionEvidence,
  saveTransactionProviderEvidence,
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
  insertUnifiedArtifact,
  listUnifiedWatchdogRuns,
  loadUnifiedAdminRunSnapshot,
  loadUnifiedProgressProjection,
  loadUnifiedUnknownDeliveryPresentation,
  persistManualUnifiedResend
} from "./unifiedCheck/repository";
import {
  createPostgresUnifiedRequestStore,
  intakeUnifiedCheck,
  UnifiedProviderWaitError
} from "./unifiedCheck/requestService";
import {
  createUnifiedRuntimeGate,
  getActiveCheckGeneration,
  handoffWalletDeliveryAndAcceptRequest,
  ownsWalletDelivery
} from "./unifiedCheck/rolloutFence";
import { createTronConfirmedSnapshotSource } from "./unifiedCheck/snapshot";
import { SELECTED_ATTRIBUTION_POLICY } from "./unifiedCheck/selectedAttributionPolicy.generated";
import { SCORING_POLICY_V4 } from "./risk/scoringPolicyV4.generated";
import { createUnifiedProductionRuntime } from "./unifiedCheck/productionRuntime";
import {
  assignUnifiedProviderPermitsWithDiagnostics,
  createUnifiedProviderRefillDiagnostics
} from "./unifiedCheck/providerRefillDiagnostics";
import { createUnifiedProviderPool } from "./unifiedCheck/providerPool";
import {
  countUnifiedActionableProviderWork,
  createUnifiedCheckpointLatencySampler,
  createUnifiedDbLatencySampler,
  createUnifiedRepairServiceTracker,
  countUnifiedActualLaneSlots,
  loadUnifiedAdaptiveStorageSnapshot,
  loadUnifiedProviderRunDemand,
  hasHealthyCapableProviderGroup,
  readUnifiedRuntimeResources,
  runUnifiedAdaptiveControllerCycle
} from "./unifiedCheck/adaptiveRuntime";
import {
  createPostgresUnifiedAdmissionRuntimeControl,
  type UnifiedAdmissionPolicy
} from "./unifiedCheck/admissionRuntimeControl";
import type {
  ProviderRunDemand
} from "./unifiedCheck/fairProviderAllocator";
import { refillOrderedAdmissions } from "./unifiedCheck/plannerRepository";
import { createUnifiedReconciliation } from "./unifiedCheck/reconciliation";
import {
  createUnifiedAdminRunDecisionStore
} from "./unifiedCheck/adminRunSnapshot";
import {
  createUnifiedAdaptiveEvent,
  createUnifiedAdaptiveObservability,
  createUnifiedPacingTracker,
  createUnifiedAdaptiveSnapshotPublisher,
  emitBestEffort,
  runUnifiedAdaptiveSnapshotPublication,
  type UnifiedAdaptiveEvent
} from "./unifiedCheck/adaptiveObservability";
import {
  applyUnifiedAdaptiveBenchmarkControl,
  acknowledgeUnifiedAdaptiveBenchmarkRestartHandoffs,
  captureUnifiedAdaptiveBenchmarkObservationBestEffort,
  buildUnifiedScopedProviderSaturationSample,
  createUnifiedAdaptiveBenchmarkProviderTelemetry,
  createUnifiedSelectedReconciliationCounter,
  isUnifiedBenchmarkCooldownSymptomReady,
  isUnifiedBenchmarkSlowHeadSymptomReady,
  loadUnifiedAdaptiveBenchmarkControl,
  persistUnifiedAdaptiveBenchmarkObservation,
  persistUnifiedProviderRefillRuntimeSample,
  persistUnifiedAdaptiveBenchmarkScenarioSymptom,
  UNIFIED_BENCHMARK_RESTART_MAX_WAIT_MS,
  type UnifiedAdaptiveBenchmarkRuntimeObservationV1
} from "./unifiedCheck/adaptiveBenchmarkControl";
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
import {
  createFrozenLabelDatasetLoader
} from "./unifiedCheck/frozenLabels";
import { createProductionLabelDatasetFreezer } from
  "./unifiedCheck/productionLabelFreeze";

const config = loadConfig();
const addressPoisoningSmallTransferMaxRaw = parseAddressPoisoningSmallTransferMaxRaw(
  config.addressPoisoningSmallTransferMaxUsdt
);
const db = createDb(config.databaseUrl);
const unifiedTransactionHost = createUnifiedPoolTransactionHost(db);
let forensicRuntimeOrchestration: ForensicRuntimeOrchestration;
let runtimeVersion: RuntimeVersionV1;
try {
  let schemaVerification: Schema036Verification | null = null;
  const schema032MigrationBytes = await readFile(
    new URL(`../migrations/${SCHEMA_032_FILENAME}`, import.meta.url)
  );
  const schema032Checksum = await checksumMigrationBytes(schema032MigrationBytes);
  const schema033MigrationBytes = await readFile(
    new URL(`../migrations/${SCHEMA_033_FILENAME}`, import.meta.url)
  );
  const schema033Checksum = await checksumMigrationBytes(schema033MigrationBytes);
  const schema035MigrationBytes = await readFile(
    new URL(`../migrations/${SCHEMA_035_FILENAME}`, import.meta.url)
  );
  const requiredMigrationBytes = await readFile(
    new URL(`../migrations/${SCHEMA_036_FILENAME}`, import.meta.url)
  );
  const schema034MigrationBytes = await readFile(
    new URL(`../migrations/${SCHEMA_034_FILENAME}`, import.meta.url)
  );
  const schema034Checksum = await checksumMigrationBytes(
    schema034MigrationBytes
  );
  const schema035Checksum = await checksumMigrationBytes(
    schema035MigrationBytes
  );
  const requiredChecksum = await checksumMigrationBytes(requiredMigrationBytes);
  forensicRuntimeOrchestration = createForensicRuntimeOrchestration({
    verifyStartupSchema: () => runStartupSchemaGate({
      verify: () =>
        verifyRequiredSchema036(
          db,
          requiredChecksum,
          schema032Checksum,
          schema033Checksum,
          schema034Checksum,
          schema035Checksum
        ),
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
const unifiedRolloutPolicy = {
  stage: config.unifiedRollingRolloutStage,
  providerCapacityCeiling: config.unifiedProviderCapacityCeiling
} as const;
logger.info("unified_generation_fence_loaded", {
  deliveryGeneration: activeCheckGeneration.deliveryGeneration,
  generationId: activeCheckGeneration.generationId
});
const runtimeCycleRecorder = createRuntimeCycleRecorder({ runtimeVersion, logger });
const unifiedAdaptiveObservability =
  createUnifiedAdaptiveObservability();
const unifiedAdaptiveSnapshotPublisher =
  createUnifiedAdaptiveSnapshotPublisher();
const unifiedPacingTracker = createUnifiedPacingTracker();
const unifiedBenchmarkProviderTelemetry =
  createUnifiedAdaptiveBenchmarkProviderTelemetry();
let activeUnifiedBenchmarkControlSha256: string | null = null;
const teardownUnifiedBenchmarkControl = (
  controlSha256: string
): void => {
  unifiedBenchmarkProviderTelemetry.teardownBenchmarkControl(
    controlSha256
  );
  tronscanScheduler.teardownBenchmarkControl(controlSha256);
};

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
  maxInFlightPerGroup: config.tronscanGroupMaxInFlight,
  // ponytail: fixed first-rollout breaker; calibrate the threshold from Plan 3
  // provider-error evidence before exposing another deployment knob.
  providerFailureCircuitThreshold: 3,
  providerCircuitOpenMs: config.tronscanRateLimitCooldownMs,
  onDispatchObservation: (observation) => {
    unifiedAdaptiveObservability.recordProviderDispatch(observation.atMs);
  },
  onDispatchOutcome: (observation) => {
    unifiedAdaptiveObservability.recordProviderOutcome(observation.outcome);
  },
  onRunDispatchObservation: (observation) => {
    unifiedBenchmarkProviderTelemetry.recordDispatch(observation);
  },
  onRunDispatchOutcome: (observation) => {
    unifiedBenchmarkProviderTelemetry.recordOutcome(observation);
  },
  onObserverSettled: (observation) => {
    unifiedPacingTracker.settled(observation);
    wakeUnifiedController();
  },
  onPacingObservation: (observation) => {
    unifiedPacingTracker.paced(observation);
    wakeUnifiedController();
  }
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
const selectiveTransactionEnricher = createSelectiveTransactionEnricher({
  getSavedEvidence: (identity) => getTransactionProviderEvidence(db, identity),
  saveProviderEvidence: (evidence) => saveTransactionProviderEvidence(db, evidence),
  saveDecisionEvidence: (evidence) => saveTransactionEnrichmentDecisionEvidence(db, evidence),
  getRawTransaction: (txHash) => tronClient.getRawTransaction(txHash),
  getFullTransactionInfo: (txHash) => tronClient.getTransaction(txHash),
  now: () => new Date()
});
const selectiveRouteAssertions = async (input: { addresses: string[]; txHashes: string[] }) =>
  (await listActiveAddressLabelAssertionsForRoute(db, { chain: "tron", ...input })).map((assertion) => ({
    chain: assertion.chain,
    address: assertion.address,
    status: assertion.status,
    evidenceJson: assertion.evidenceJson
  }));
const indexedMovementsByHashes = async (txHashes: string[]) =>
  (await listIndexedTronUsdtTransfersByHashes(db, [...new Set(txHashes.map((hash) => hash.toLowerCase()))]))
    .map(indexedTransferToRouteEdge);
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
const freezeProductionLabelDataset = createProductionLabelDatasetFreezer({
  traversalPolicyVersion: config.unifiedTraversalPolicyVersion,
  legacyRows: unifiedLabelRows,
  loadFreshProviderMetadata: (frozenAt) =>
    listFreshTaggedAddressMetadataAt(db, frozenAt),
  observe: (diagnostic) =>
    logger.info("unified_provider_service_freeze", diagnostic)
});
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
let wakeUnifiedController: () => void = () => undefined;
const unifiedCheckpointLatencySampler =
  createUnifiedCheckpointLatencySampler();
const unifiedProviderRefillDiagnostics =
  createUnifiedProviderRefillDiagnostics();
const unifiedSelectedReconciliationCounter =
  createUnifiedSelectedReconciliationCounter();
const emitUnifiedAdaptiveEvent = (event: UnifiedAdaptiveEvent) => {
  unifiedSelectedReconciliationCounter.record(event);
  logger.info("unified_adaptive_event", { ...event });
};
const loadUnifiedFrozenLabelDataset = createFrozenLabelDatasetLoader({
  loadBySha256: async (labelDatasetSha256) => (
    await db.query(
      "select dataset_json from unified_label_datasets where sha256 = $1",
      [labelDatasetSha256]
    )
  ).rows[0]?.dataset_json
});
const unifiedProductionRuntime = createUnifiedProductionRuntime({
  db: unifiedTransactionHost,
  runtimeCommit: runtimeVersion.gitCommitSha,
  providerConfigurationSha256: unifiedProviderConfiguration.sha256,
  runPurpose: config.unifiedIsolatedWorkerOnly ? "release_canary" : undefined,
  providerChunkBudget: {
    maxWorkUnits: config.unifiedChunkMaxPages,
    maxWallMs: config.unifiedChunkMaxWallMs,
    maxResponseBytes: config.unifiedChunkMaxResponseBytes,
    maxCheckpointBytes: config.unifiedChunkMaxCheckpointBytes
  },
  now: () => new Date(),
  createId: randomUUID,
  manifestMaxBytes: config.unifiedManifestHardLimitBytes,
  commitMaxEntries: config.unifiedReadyBufferMaxEntries,
  commitMaxBytes: config.unifiedReadyBufferMaxBytes,
  onProviderWorkAvailable: () => wakeUnifiedController(),
  onCheckpointLatencyMs: (latencyMs) => {
    unifiedCheckpointLatencySampler.record(latencyMs);
  },
  onAdaptiveEvent: emitUnifiedAdaptiveEvent,
  providerRefillDiagnostics: unifiedProviderRefillDiagnostics,
  requireProviderClaimPermit: true,
  async loadProviderPage({
    run,
    address = run.subjectAddress,
    cursor,
    taskId,
    canonicalSequence,
    attempt,
    providerSlot,
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
                ),
                observationScope: "unified",
                observationRunId: run.id,
                observationTaskId: taskId,
                observationCanonicalSequence:
                  canonicalSequence ?? undefined,
                observationAttempt: attempt,
                observationSlotId: providerSlot?.slotId,
                observationSlotEpoch: providerSlot?.epoch
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
      legacyRows?: unknown;
    } | undefined;
    const rows = stored?.version === "unified-label-dataset-v1"
      ? stored.rows
      : stored?.version === "unified-frozen-label-dataset-v1"
        ? stored.legacyRows
        : undefined;
    if (
      !stored ||
      !Array.isArray(rows) ||
      fingerprintCanonicalArtifact(stored) !== labelDatasetSha256
    ) {
      throw new Error("unified_label_dataset_persistence_mismatch");
    }
    const requested = new Set(addresses);
    const labels = new Map<string, string[]>();
    for (const raw of rows) {
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
  async loadFrozenLabelDataset({
    labelDatasetSha256,
    snapshotHash,
    labelCatalogVersion,
    boundaryPredicateVersion
  }) {
    return loadUnifiedFrozenLabelDataset({
      labelDatasetSha256,
      snapshotHash,
      labelCatalogVersion,
      boundaryPredicateVersion
    });
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
const unifiedRepairServiceTracker = createUnifiedRepairServiceTracker({
  repairMaxWaitChunks: config.unifiedRepairMaxWaitChunks,
  onWaitViolation: (event) =>
    emitBestEffort(emitUnifiedAdaptiveEvent, event)
});
const unifiedDbLatencySampler = createUnifiedDbLatencySampler();
const measureUnifiedDb = async <T>(work: () => Promise<T>): Promise<T> => {
  const startedAtMs = performance.now();
  try {
    return await work();
  } finally {
    unifiedDbLatencySampler.record(performance.now() - startedAtMs);
  }
};
const unifiedBenchmarkRuntimeInstanceId = randomUUID();
const unifiedBenchmarkProcessStartedAt = new Date(
  Date.now() - Math.floor(process.uptime() * 1_000)
).toISOString();
const unifiedProviderPool = createUnifiedProviderPool({
  configuredLimit: config.unifiedProviderConcurrencyLimit,
  requiresPermit: true,
  yieldAfterClaim: true,
  async runCycle(slotId, assignment, slotIdentity) {
    if (!assignment) return { claimed: false };
    const result = await unifiedProductionRuntime.runProviderCycle(
      slotId,
      assignment.permit,
      slotIdentity
    );
    if (result.claimed) {
      unifiedRepairServiceTracker.recordClaim(assignment.permit.lane);
    }
    return result;
  },
  onSlotBoundary: () => wakeUnifiedController(),
  onAssignmentsEvaluated: (result) => {
    unifiedProviderRefillDiagnostics.recordAssignmentsEvaluated(
      result,
      performance.now()
    );
  },
  onError(error, slotId) {
    logger.error("unified_provider_pool_slot_failed", {
      slotId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});
let unifiedProviderRampState = {
  target: 0,
  lastIncreaseAtMs:
    Date.now() - config.unifiedProviderIncreaseIntervalMs
};
const unifiedAdminRunDecisionStore =
  createUnifiedAdminRunDecisionStore();
let unifiedLastRuntimeResourceState:
  "normal" | "pressure" | "critical" | null = null;
const unifiedAdmissionRuntimeControl =
  createPostgresUnifiedAdmissionRuntimeControl({
    db: unifiedTransactionHost,
    initialPolicy:
      unifiedRolloutPolicy.stage === "global_barrier"
        ? "barrier"
        : "rolling",
    readyBufferMaxEntries: config.unifiedReadyBufferMaxEntries,
    readyBufferMaxBytes: config.unifiedReadyBufferMaxBytes,
    reservedBufferMaxBytes: config.unifiedReservedBufferMaxBytes,
    reservationBytesPerTask: config.unifiedManifestHardLimitBytes,
    now: () => new Date(),
    wake: () => wakeUnifiedController()
  });
let unifiedCooldownWake: NodeJS.Timeout | null = null;
const unifiedResourceThresholds = {
  // ponytail: conservative first-rollout guards; expose deployment-specific
  // calibration only after Plan 3 benchmark evidence exists.
  pressureAvailableMemoryBytes: 1_073_741_824,
  criticalAvailableMemoryBytes: 268_435_456,
  pressureRssBytes: 2_147_483_648,
  criticalRssBytes: 3_221_225_472,
  pressureDbWaitingCount: 4,
  criticalDbWaitingCount: 16,
  pressureDbLatencyMs: 500,
  criticalDbLatencyMs: 2_000,
  pressureCheckpointLatencyMs: 1_000,
  criticalCheckpointLatencyMs: 5_000
};
const runUnifiedControllerCycle = async (
  admissionPolicy: UnifiedAdmissionPolicy
) => {
  const startedAtMs = Date.now();
  const providerGroups = tronscanScheduler.groupSnapshots();
  const providerAvailable =
    hasHealthyCapableProviderGroup(providerGroups);
  const loadedDemandWithoutPolicy = await measureUnifiedDb(() =>
    loadUnifiedProviderRunDemand(unifiedTransactionHost, {
      now: new Date(startedAtMs),
      providerAvailable,
      readyBufferMaxEntries: config.unifiedReadyBufferMaxEntries,
      readyBufferMaxBytes: config.unifiedReadyBufferMaxBytes,
      runtimeCommit: runtimeVersion.gitCommitSha,
      providerConfigurationSha256: unifiedProviderConfiguration.sha256
      })
  );
  const loadedDemand = loadedDemandWithoutPolicy.map((run) => ({
    ...run,
    admissionPolicy: admissionPolicy === "barrier"
      ? "barrier" as const
      : run.admissionPolicy ?? "barrier"
  }));
  let benchmarkControl:
    Awaited<ReturnType<typeof loadUnifiedAdaptiveBenchmarkControl>> =
      null;
  let demand: ProviderRunDemand[] = [...loadedDemand];
  try {
    benchmarkControl = await measureUnifiedDb(() =>
      loadUnifiedAdaptiveBenchmarkControl(unifiedTransactionHost, {
        now: new Date(startedAtMs),
        runtimeCommit: runtimeVersion.gitCommitSha,
        providerConfigurationSha256:
          unifiedProviderConfiguration.sha256
      })
    );
    const nextControlSha256 = benchmarkControl?.sha256 ?? null;
    if (activeUnifiedBenchmarkControlSha256 !== nextControlSha256) {
      unifiedProviderRefillDiagnostics.setRunScope(
        benchmarkControl?.control.runPlans.map((plan) => plan.runId) ?? null
      );
      unifiedSelectedReconciliationCounter.activate(
        nextControlSha256,
        benchmarkControl?.control.runPlans.map((plan) => plan.runId) ?? []
      );
    }
    if (
      activeUnifiedBenchmarkControlSha256 !== null &&
      activeUnifiedBenchmarkControlSha256 !== nextControlSha256
    ) {
      teardownUnifiedBenchmarkControl(
        activeUnifiedBenchmarkControlSha256
      );
    }
    activeUnifiedBenchmarkControlSha256 = nextControlSha256;
    if (
      benchmarkControl !== null &&
      (
        benchmarkControl.control.auditedGroupIds.length <
          benchmarkControl.control.capacity ||
        benchmarkControl.control.auditedGroupIds.some((groupId) =>
          !providerGroups.some((group) => group.groupId === groupId)
        )
      )
    ) {
      throw new Error(
        "unified_benchmark_control_group_binding_invalid"
      );
    }
    if (benchmarkControl !== null) {
      unifiedBenchmarkProviderTelemetry.bindControl(
        benchmarkControl.sha256,
        benchmarkControl.control.runPlans.map((plan) => plan.runId)
      );
      for (const plan of benchmarkControl.control.runPlans) {
        if (
          plan.fault === "slow_canonical_head" &&
          !benchmarkControl.acknowledgedRunIds.includes(plan.runId) &&
          plan.faultUntil !== null
        ) {
          const existing =
            tronscanScheduler.benchmarkRunDelay(plan.runId);
          if (existing === null) {
            const head = (await unifiedTransactionHost.query(
              `select task_id, canonical_sequence
                 from unified_check_planner_entries
                where run_id = $1
                  and planner_state <> 'committed'
                order by canonical_sequence
                limit 1`,
              [plan.runId]
            )).rows[0];
            if (head) {
              tronscanScheduler.installBenchmarkRunDelay({
                controlSha256: benchmarkControl.sha256,
                runId: plan.runId,
                taskId: String(head.task_id),
                canonicalSequence: Number(head.canonical_sequence),
                startsAtMs: Date.parse(
                  benchmarkControl.control.createdAt
                ),
                endsAtMs: Date.parse(plan.faultUntil)
              });
            }
          }
        }
        if (
          plan.fault !== "provider_cooldown" ||
          benchmarkControl.acknowledgedRunIds.includes(plan.runId) ||
          plan.faultUntil === null
        ) {
          continue;
        }
        tronscanScheduler.installBenchmarkGroupCooldown({
          controlSha256: benchmarkControl.sha256,
          runId: plan.runId,
          groupId: benchmarkControl.control.auditedGroupIds[0]!,
          startsAtMs: Date.parse(benchmarkControl.control.createdAt),
          endsAtMs: Date.parse(plan.faultUntil)
        });
      }
    }
    demand = applyUnifiedAdaptiveBenchmarkControl({
      demand: loadedDemand,
      providerSlots: unifiedProviderPool.slotSnapshots(),
      control: benchmarkControl?.control ?? null,
      acknowledgedRunIds:
        benchmarkControl?.acknowledgedRunIds ?? [],
      now: new Date(startedAtMs)
    });
  } catch (error) {
    benchmarkControl = null;
    logger.warn("unified_benchmark_control_disabled", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
  unifiedRepairServiceTracker.updateRepairReady(demand.some((run) =>
    run.lane === "repair" && run.eligibleReadyWork > 0
  ));
  const resources = await readUnifiedRuntimeResources({
    dbWaitingCount: db.waitingCount,
    dbLatencyMs: unifiedDbLatencySampler.sampleAndReset(),
    checkpointLatencyMs:
      unifiedCheckpointLatencySampler.sampleAndReset()
  });
  const scheduler = tronscanScheduler.diagnostics();
  const result = await runUnifiedAdaptiveControllerCycle({
    nowMs: startedAtMs,
    rampState: unifiedProviderRampState,
    providerGroups,
    resources,
    thresholds: unifiedResourceThresholds,
    providerSlots: unifiedProviderPool.slotSnapshots(),
    isProviderSlotPaced: (slot) =>
      unifiedPacingTracker.isSlotPaced(slot),
    config: {
      configuredProviderConcurrencyLimit:
        Math.min(
          config.unifiedProviderConcurrencyLimit,
          unifiedRolloutPolicy.providerCapacityCeiling
        ),
      providerWorkerLimit: Math.min(
        config.unifiedProviderWorkerLimit,
        scheduler.maxInFlight
      ),
      providerIncreaseStep: config.unifiedProviderIncreaseStep,
      providerIncreaseIntervalMs:
        config.unifiedProviderIncreaseIntervalMs,
      analysisConcurrencyLimit: config.unifiedAnalysisConcurrencyLimit,
      finalizationConcurrencyLimit:
        config.unifiedFinalizationConcurrencyLimit,
      admissionPolicy,
      lookaheadFactor: config.unifiedLookaheadFactor,
      perRunLookaheadMaximum:
        config.unifiedPerRunLookaheadMaximum,
      readyBufferMaxEntries: config.unifiedReadyBufferMaxEntries,
      readyBufferMaxBytes: config.unifiedReadyBufferMaxBytes,
      reservedBufferMaxBytes: config.unifiedReservedBufferMaxBytes,
      reservationBytesPerTask: config.unifiedManifestHardLimitBytes,
      repairShare: config.unifiedRepairShare,
      repairMaxSlots: config.unifiedRepairMaxSlots,
      repairMaxWaitChunks: config.unifiedRepairMaxWaitChunks,
      chunksSinceLastRepair:
        unifiedRepairServiceTracker.snapshot().chunksSinceLastRepair
    },
    demand,
    refill: (admission) => measureUnifiedDb(() =>
      refillOrderedAdmissions(unifiedTransactionHost, admission)
    ),
    countActionableProviderWork: (scopes) => measureUnifiedDb(() =>
      countUnifiedActionableProviderWork(unifiedTransactionHost, {
        now: new Date(),
        scopes,
        runtimeCommit: runtimeVersion.gitCommitSha,
        providerConfigurationSha256: unifiedProviderConfiguration.sha256
      })
    ),
    assignProviderPermits: (assignments) =>
      assignUnifiedProviderPermitsWithDiagnostics({
        assignments,
        diagnostics: unifiedProviderRefillDiagnostics,
        now: () => performance.now(),
        assignPermits: (proposals) =>
          unifiedProviderPool.assignPermits(proposals)
      }),
    setPoolTarget: (target) =>
      unifiedProviderPool.setTargetSlots(target),
    wakePool: () => unifiedProviderPool.wake(),
    requestControllerWake: () => wakeUnifiedController(),
    onDecision: (decision) => {
      unifiedAdminRunDecisionStore.replace(decision.runDecisions);
      if (
        unifiedLastRuntimeResourceState !== null &&
        unifiedLastRuntimeResourceState !== decision.runtimeState
      ) {
        emitBestEffort(
          emitUnifiedAdaptiveEvent,
          createUnifiedAdaptiveEvent({
            type: "resource_state_changed",
            occurredAt: new Date(startedAtMs).toISOString(),
            reason: decision.limitingReason ?? undefined
          })
        );
      }
      unifiedLastRuntimeResourceState = decision.runtimeState;
    }
  });
  await runUnifiedAdaptiveSnapshotPublication({
    load: () => loadUnifiedAdaptiveStorageSnapshot(
      unifiedTransactionHost,
      {
        now: new Date(startedAtMs),
        runtimeCommit: runtimeVersion.gitCommitSha,
        providerConfigurationSha256: unifiedProviderConfiguration.sha256
      }
    ),
    build: (storage) => {
      const repairReady = demand.reduce((sum, item) =>
        sum + (item.lane === "repair" ? item.eligibleReadyWork : 0), 0);
      const actualRepairSlots = countUnifiedActualLaneSlots({
        lane: "repair",
        slotSnapshots: unifiedProviderPool.slotSnapshots()
      });
      const repairMinimum = repairReady === 0
        ? 0
        : Math.min(
            repairReady,
            config.unifiedRepairMaxSlots,
            Math.max(
              1,
              Math.ceil(
                result.providerCapacityLimit * config.unifiedRepairShare
              )
            )
          );
      return unifiedAdaptiveObservability.snapshot({
        nowMs: startedAtMs,
        provider: {
          capacityLimit: result.providerCapacityLimit,
          readyDemand: result.eligibleReadyProviderWork,
          targetActiveSlots: result.targetActiveProviderSlots,
          actualActiveSlots: result.actualActiveProviderSlots,
          healthyGroups: providerGroups.filter((item) =>
            item.state === "healthy"
          ).length,
          cooldownGroups: providerGroups.filter((item) =>
            item.state === "cooldown"
          ).length,
          circuitOpenGroups: providerGroups.filter((item) =>
            item.state === "circuit_open"
          ).length
        },
        runtime: {
          state: result.runtimeState,
          limitingReason: result.limitingReason
        },
        memory: {
          rssBytes: resources.rssBytes,
          heapUsedBytes: resources.heapUsedBytes,
          availableMemoryBytes: resources.availableMemoryBytes
        },
        database: {
          poolWaiting: resources.dbWaitingCount,
          latencyMs: resources.dbLatencyMs
        },
        checkpointLatencyMs: resources.checkpointLatencyMs,
        ...storage,
        repair: {
          minimumSlots: repairMinimum,
          actualSlots: actualRepairSlots,
          waitViolations:
            unifiedRepairServiceTracker.snapshot().waitViolations
        }
      });
    },
    publish: (snapshot) =>
      unifiedAdaptiveSnapshotPublisher.publish(snapshot),
    warn(error) {
      logger.warn("unified_adaptive_snapshot_publish_failed", {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
  unifiedProviderRampState = result.rampState;
  if (unifiedCooldownWake !== null) {
    clearTimeout(unifiedCooldownWake);
    unifiedCooldownWake = null;
  }
  const nextCooldown = providerGroups
    .map((group) => group.cooldownUntil)
    .filter((value): value is number =>
      value !== null && value > Date.now()
    )
    .sort((left, right) => left - right)[0];
  if (nextCooldown !== undefined) {
    unifiedCooldownWake = setTimeout(
      () => wakeUnifiedController(),
      Math.max(1, nextCooldown - Date.now())
    );
    unifiedCooldownWake.unref?.();
  }
  const analysisResults = await Promise.all(Array.from(
    { length: result.analysisConcurrencyLimit },
    () => unifiedProductionRuntime.runAnalysisCycle()
  ));
  if (analysisResults.some((cycle) => cycle.claimed)) {
    // Coordinator commits and task lifecycle changes are durable now. The
    // coalesced pending cycle recalculates admission from that new state.
    wakeUnifiedController();
  }
  const finalizationResults = await Promise.all(Array.from(
    { length: result.finalizationConcurrencyLimit },
    () => unifiedProductionRuntime.runFinalizationCycle()
  ));
  for (const finalized of finalizationResults) {
    if (!finalized.finalized) continue;
    logger.info("unified_wallet_check_finalized", {
      runId: finalized.runId
    });
  }
  if (benchmarkControl !== null) {
    await captureUnifiedAdaptiveBenchmarkObservationBestEffort({
      capture: async () => {
        const poolWaitStartedAtMs = performance.now();
        const benchmarkPoolClient = await db.connect();
        const poolWaitMs = performance.now() - poolWaitStartedAtMs;
        benchmarkPoolClient.release();
        const snapshotStartedAtMs = performance.now();
        const plans = benchmarkControl.control.runPlans;
        const snapshots = await Promise.all(plans.map(async (plan) => ({
          plan,
          snapshot: await loadUnifiedAdminRunSnapshot(
            unifiedTransactionHost,
            {
              runId: plan.runId,
              now: new Date(),
              decision: result.runDecisions.find((decision) =>
                decision.runId === plan.runId
              ) ?? null
            }
          ),
          progress: await loadUnifiedProgressProjection(
            unifiedTransactionHost,
            {
              runId: plan.runId,
              now: new Date(),
              configuredSlots: Math.max(
                1,
                benchmarkControl.control.capacity
              )
            }
          )
        })));
        const databaseLatencyMs = performance.now() - snapshotStartedAtMs;
        if (snapshots.some((item) => item.snapshot === null)) {
          throw new Error("unified_benchmark_observation_run_missing");
        }
        const processMemory = process.memoryUsage();
        const runObservations = snapshots.map(({ plan, snapshot }) => {
          const value = snapshot!;
          const decision = result.runDecisions.find((item) =>
            item.runId === plan.runId
          );
          return {
            runId: plan.runId,
            scenarioId: plan.scenarioId,
            planner: value.planner,
            buffer: value.buffer,
            canonicalHeadAgeMs: value.canonicalHead?.ageMs ?? null,
            capacity: {
              eligibleDemand: loadedDemand
                .filter((item) => item.runId === plan.runId)
                .reduce((sum, item) =>
                  sum + item.eligibleReadyWork, 0),
              targetSlots: result.allocations
                .filter((item) => item.runId === plan.runId)
                .reduce((sum, item) => sum + item.slots, 0),
              actualSlots: (decision?.activeSlots ?? 0) +
                result.acceptedClaimAssignments.filter((assignment) =>
                  assignment.permit.runId === plan.runId
                ).length
            },
            limitingReason: decision?.blocker ?? null
          };
        });
        const observationByRunId = new Map<string, {
          observation: UnifiedAdaptiveBenchmarkRuntimeObservationV1;
          sha256: string;
        }>();
        const scenarioIds = [...new Set(plans.map((plan) =>
          plan.scenarioId
        ))];
        for (const scenarioId of scenarioIds) {
          const scopedSnapshots = snapshots.filter((item) =>
            item.plan.scenarioId === scenarioId
          );
          const scopedRunIds = scopedSnapshots.map((item) =>
            item.plan.runId
          );
          const scopedRuns = runObservations.filter((run) =>
            scopedRunIds.includes(run.runId)
          );
          const scopedSaturation =
            benchmarkControl.control.runPlans.length === 1
              ? buildUnifiedScopedProviderSaturationSample({
                  controlledRunIds: scopedRunIds,
                  providerCapacityLimit:
                    benchmarkControl.control.capacity,
                  runtimeState: result.runtimeState,
                  healthyGroupCount: providerGroups.filter((group) =>
                    group.state === "healthy"
                  ).length,
                  runs: scopedRuns.map((run) => ({
                    runId: run.runId,
                    eligibleDemand: run.capacity.eligibleDemand,
                    actualSlots: run.capacity.actualSlots,
                    limitingReason: run.limitingReason
                  })),
                  activeProviderRunIds: unifiedProviderPool.slotSnapshots()
                    .flatMap((slot) =>
                      slot.active && slot.activePermit !== null
                        ? [slot.activePermit.runId]
                        : []
                    ).concat(result.acceptedClaimAssignments.map(
                      (assignment) => assignment.permit.runId
                    ))
                })
              : {
                  providerCapacityLimit: result.providerCapacityLimit,
                  eligibleReadyProviderWork:
                    result.eligibleReadyProviderWork,
                  runtimeState: result.runtimeState,
                  healthyGroupCount: providerGroups.filter((group) =>
                    group.state === "healthy"
                  ).length,
                  activeSlots: result.actualActiveProviderSlots,
                  limitingReason: result.limitingReason?.code ?? null
                };
          await persistUnifiedProviderRefillRuntimeSample({
            db: unifiedTransactionHost,
            createdByRunId: scopedRunIds[0]!,
            sample: {
              version: "unified-provider-refill-runtime-sample-v1",
              controlSha256: benchmarkControl.sha256,
              observedAt: new Date().toISOString(),
              runtimeCommit: runtimeVersion.gitCommitSha,
              providerConfigurationSha256:
                unifiedProviderConfiguration.sha256,
              runIds: scopedRunIds,
              diagnostics: unifiedProviderRefillDiagnostics.snapshot(),
              saturationSample: scopedSaturation
            }
          });
          const integrity = (await unifiedTransactionHost.query(
            `select
               (
                 count(*) filter (
                   where planner.planner_state = 'committed'
                 ) -
                 count(distinct planner.task_id) filter (
                   where planner.planner_state = 'committed'
                 )
               )::int as duplicate_commits,
               (
                 count(*) filter (
                   where planner.planner_state = 'committed'
                 ) -
                 count(distinct (
                   planner.run_id, planner.canonical_sequence
                 )) filter (
                   where planner.planner_state = 'committed'
                 )
               )::int as duplicate_sequences,
               (
                 select count(*)::int
                   from unified_check_deliveries delivery
                   join unified_check_requests request
                     on request.id = delivery.request_id
                  where request.run_id = any($1::text[])
               ) as delivery_intents
             from unified_check_planner_entries planner
            where planner.run_id = any($1::text[])`,
            [scopedRunIds]
          )).rows[0]!;
          const observation: UnifiedAdaptiveBenchmarkRuntimeObservationV1 = {
            version: "unified-adaptive-benchmark-runtime-observation-v1",
            controlSha256: benchmarkControl.sha256,
            observedAt: new Date().toISOString(),
            runtime: {
              rssHeapScope: "process",
              availableMemoryScope: "container_or_host",
              instanceId: unifiedBenchmarkRuntimeInstanceId,
              processStartedAt: unifiedBenchmarkProcessStartedAt,
              processId: process.pid,
              rssBytes: processMemory.rss,
              heapUsedBytes: processMemory.heapUsed,
              availableContainerBytes: resources.availableMemoryBytes,
              availableHostBytes: freemem()
            },
            provider: unifiedBenchmarkProviderTelemetry.snapshot(
              benchmarkControl.sha256,
              Date.now(),
              scopedRunIds
            ),
            reuse: {
              providerCacheHits: scopedSnapshots.reduce((sum, item) =>
                sum + item.progress.reuse.providerCacheHits, 0),
              networkFetches: scopedSnapshots.reduce((sum, item) =>
                sum + item.progress.reuse.networkFetches, 0),
              addressManifestReuses: scopedSnapshots.reduce((sum, item) =>
                sum + item.progress.reuse.manifestReuses, 0),
              addressHistoryReplaysAvoided: scopedSnapshots.reduce(
                (sum, item) => sum + item.progress.reuse.replayAvoided,
                0
              )
            },
            integrity: {
              duplicateCommits: Number(integrity.duplicate_commits),
              duplicateSequences: Number(integrity.duplicate_sequences),
              deliveryIntents: Number(integrity.delivery_intents)
            },
            database: {
              scope: "benchmark_runtime_connection_pool",
              latencyMs: databaseLatencyMs,
              checkpointLatencyMs: resources.checkpointLatencyMs,
              poolWaitMs
            },
            lifecycle: {
              restartRunId: null,
              checkpointObservationSha256: null,
              restartCount: 0,
              recoveryMs: 0,
              reconciliationRecoveries: scopedRunIds.reduce(
                (sum, runId) => sum +
                  unifiedSelectedReconciliationCounter.count(
                    benchmarkControl.sha256,
                    runId
                  ),
                0
              )
            },
            runs: scopedRuns
          };
          const observationSha256 =
            await persistUnifiedAdaptiveBenchmarkObservation({
              db: unifiedTransactionHost,
              createdByRunId: scopedRunIds[0]!,
              observation
            });
          for (const runId of scopedRunIds) {
            observationByRunId.set(runId, {
              observation,
              sha256: observationSha256
            });
          }
        }
        for (const plan of plans) {
          if (
            benchmarkControl.acknowledgedRunIds.includes(plan.runId)
          ) {
            continue;
          }
          const scoped = observationByRunId.get(plan.runId)!;
          const observation = scoped.observation;
          const observationSha256 = scoped.sha256;
          const run = observation.runs.find((item) =>
            item.runId === plan.runId
          )!;
          const peerCommitted = runObservations.some((item) =>
            item.runId !== plan.runId && item.planner.committed > 0
          );
          const syntheticCooldown =
            tronscanScheduler.benchmarkGroupCooldown(plan.runId);
          const slowHeadDelay =
            tronscanScheduler.benchmarkRunDelay(plan.runId);
          const slowHeadAccepted = slowHeadDelay === null ||
              plan.faultUntil === null
            ? undefined
            : (await unifiedTransactionHost.query(
                `select attempt.id as attempt_id,
                        attempt.attempt,
                        attempt.artifact_sha256,
                        attempt.completed_at,
                        planner.committed_at
                   from unified_check_planner_entries planner
                   join unified_check_tasks task
                     on task.run_id = planner.run_id
                    and task.id = planner.task_id
                   join unified_check_attempts attempt
                     on attempt.id = task.accepted_attempt_id
                    and attempt.task_id = task.id
                  where planner.run_id = $1
                    and planner.task_id = $2
                    and planner.canonical_sequence = $3
                    and planner.planner_state = 'committed'
                    and planner.committed_at is not null
                    and task.status = 'COMPLETED'
                    and attempt.completed_at >= $4::timestamptz
                  limit 1`,
                [
                  plan.runId,
                  slowHeadDelay.taskId,
                  slowHeadDelay.canonicalSequence,
                  plan.faultUntil
                ]
              )).rows[0] as {
                attempt_id?: string;
                attempt?: number | string;
                artifact_sha256?: string;
                completed_at?: Date | string;
                committed_at?: Date | string;
              } | undefined;
          const slowHeadAcceptedAttempt = slowHeadAccepted === undefined
            ? null
            : {
                taskId: slowHeadDelay!.taskId,
                canonicalSequence:
                  slowHeadDelay!.canonicalSequence,
                attempt: Number(slowHeadAccepted.attempt),
                completedAtMs: new Date(
                  slowHeadAccepted.completed_at!
                ).getTime()
              };
          const cooldownObserved =
            isUnifiedBenchmarkCooldownSymptomReady({
              capacity: benchmarkControl.control.capacity,
              controlSha256: benchmarkControl.sha256,
              auditedGroupIds:
                benchmarkControl.control.auditedGroupIds,
              nowMs: Date.now(),
              cooldown: syntheticCooldown
            });
          const phase = plan.fault === "provider_cooldown" &&
              syntheticCooldown !== null &&
              cooldownObserved
            ? "audited_group_cooldown_observed" as const
            : plan.fault === "slow_canonical_head" &&
                isUnifiedBenchmarkSlowHeadSymptomReady({
                  controlSha256: benchmarkControl.sha256,
                  committed: slowHeadAccepted?.committed_at != null,
                  faultUntilMs: Date.parse(plan.faultUntil ?? ""),
                  acceptedAttempt: slowHeadAcceptedAttempt,
                  delay: slowHeadDelay
                })
              ? "canonical_head_delay_observed" as const
              : plan.fault === "merge_buffer_full" &&
                  run.limitingReason?.code === "merge_buffer_full"
                ? "merge_buffer_full_observed" as const
                : plan.scenarioId === "late_interactive" &&
                    peerCommitted
                  ? "late_after_peer_checkpoint" as const
                  : plan.fault === "none" &&
                      run.planner.committed > 0 &&
                      run.planner.durableBacklog === 0 &&
                      run.planner.admitted === 0 &&
                      run.planner.leased === 0 &&
                      run.planner.ready === 0
                    ? "run_completed" as const
                    : null;
          if (phase !== null) {
            await persistUnifiedAdaptiveBenchmarkScenarioSymptom({
              db: unifiedTransactionHost,
              createdByRunId: plan.runId,
              symptom: {
                version:
                  "unified-adaptive-benchmark-scenario-symptom-v1",
                controlSha256: benchmarkControl.sha256,
                runId: plan.runId,
                scenarioId: plan.scenarioId,
                phase,
                observedAt: new Date().toISOString(),
                observationArtifactSha256: observationSha256,
                runtimeInstanceId: unifiedBenchmarkRuntimeInstanceId,
                runtimeProcessStartedAt: unifiedBenchmarkProcessStartedAt,
                runtimeProcessId: process.pid,
                ...(phase === "canonical_head_delay_observed" &&
                  slowHeadAccepted !== undefined &&
                  slowHeadDelay !== null
                  ? {
                      slowHeadAcceptance: {
                        taskId: slowHeadDelay.taskId,
                        canonicalSequence:
                          slowHeadDelay.canonicalSequence,
                        attemptId: String(
                          slowHeadAccepted.attempt_id
                        ),
                        artifactSha256: String(
                          slowHeadAccepted.artifact_sha256
                        ),
                        completedAt: new Date(
                          slowHeadAccepted.completed_at!
                        ).toISOString()
                      }
                    }
                  : {}),
                ...(phase === "audited_group_cooldown_observed" &&
                  syntheticCooldown !== null
                  ? {
                      providerCooldown: {
                        groupId: syntheticCooldown.groupId,
                        startsAt: new Date(
                          syntheticCooldown.startsAtMs
                        ).toISOString(),
                        endsAt: new Date(
                          syntheticCooldown.endsAtMs
                        ).toISOString(),
                        fallbackDispatches:
                          syntheticCooldown.fallbackDispatches,
                        resumedDispatches:
                          syntheticCooldown.resumedDispatches,
                        activeObserved: true as const,
                        synthetic: true as const,
                        provider429Observed: false as const
                      }
                    }
                  : {})
              }
            });
          }
          if (plan.fault !== "restart_recovery") continue;
          const handoff = (await unifiedTransactionHost.query(
            `select artifact_json
               from unified_check_artifacts
              where kind = 'adaptive_benchmark_restart_handoff'
                and artifact_json->>'controlSha256' = $1
                and artifact_json->>'runId' = $2
              order by created_at desc, sha256
              limit 1`,
            [benchmarkControl.sha256, plan.runId]
          )).rows[0]?.artifact_json as {
            requestedAt?: string;
            runtimeInstanceId?: string;
            runtimeProcessStartedAt?: string;
            runtimeProcessId?: number;
            checkpointObservationSha256?: string;
          } | undefined;
          if (!handoff) {
            const checkpointedHead = (
              await unifiedTransactionHost.query(
                `select entry.task_id, entry.canonical_sequence,
                        task.attempt
                   from unified_check_planner_entries entry
                   join unified_check_tasks task
                     on task.run_id = entry.run_id
                    and task.id = entry.task_id
                   join unified_check_runs run
                     on run.id = entry.run_id
                  where entry.run_id = $1
                    and entry.planner_state <> 'committed'
                    and entry.canonical_sequence = (
                      select min(head.canonical_sequence)
                        from unified_check_planner_entries head
                       where head.run_id = entry.run_id
                         and head.planner_state <> 'committed'
                    )
                    and run.status = 'RUNNING'
                    and task.status = 'QUEUED'
                    and task.checkpoint_json->'recentAttempts'
                          ->-1->>'outcome' = 'CHECKPOINTED'
                  limit 1`,
                [plan.runId]
              )
            ).rows[0];
            if (!checkpointedHead) continue;
            const requestedAt = new Date();
            const request = {
              version: "unified-adaptive-benchmark-restart-handoff-v1",
              controlSha256: benchmarkControl.sha256,
              runId: plan.runId,
              scenarioId: plan.scenarioId,
              requestedAt: requestedAt.toISOString(),
              resumeDeadline: new Date(
                requestedAt.getTime() +
                  UNIFIED_BENCHMARK_RESTART_MAX_WAIT_MS
              ).toISOString(),
              runtimeInstanceId: unifiedBenchmarkRuntimeInstanceId,
              runtimeProcessStartedAt: unifiedBenchmarkProcessStartedAt,
              runtimeProcessId: process.pid,
              checkpointObservationSha256: observationSha256,
              checkpointTaskId: String(checkpointedHead.task_id),
              checkpointCanonicalSequence: Number(
                checkpointedHead.canonical_sequence
              ),
              checkpointAttempt: Number(checkpointedHead.attempt)
            };
            await insertUnifiedArtifact(unifiedTransactionHost, {
              sha256: fingerprintCanonicalArtifact(request),
              createdByRunId: plan.runId,
              kind: "adaptive_benchmark_restart_handoff",
              schemaVersion: "1",
              artifact: request
            });
          }
        }
      },
      onError(error) {
        logger.error("unified_benchmark_observation_failed", {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });
  }
  return {
    actionableWorkFound: result.eligibleReadyProviderWork > 0,
    admitted: result.admitted,
    wokenSlots: result.actionableProviderSlots
  };
};
const createRuntimeUnifiedReconciliation = () =>
  createUnifiedReconciliation({
  intervalMs: config.unifiedReconciliationIntervalMs,
  async runCycle() {
    const result =
      await unifiedAdmissionRuntimeControl.runControllerCycle(
        runUnifiedControllerCycle
      );
    try {
      await acknowledgeUnifiedAdaptiveBenchmarkRestartHandoffs({
        db: unifiedTransactionHost,
        now: new Date(),
        runtime: {
          instanceId: unifiedBenchmarkRuntimeInstanceId,
          processStartedAt: unifiedBenchmarkProcessStartedAt,
          processId: process.pid
        },
        reconciliationResult: result,
        tickObservedAt: new Date().toISOString()
      });
    } catch (error) {
      logger.warn("unified_benchmark_restart_ack_disabled", {
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return result;
  },
  onResult(result) {
    unifiedAdaptiveObservability.recordReconciliation(result);
  },
  onAdaptiveEvent: emitUnifiedAdaptiveEvent,
  onWait(reason) {
    logger.info("unified_adaptive_decision", { reason });
  },
  onError(error) {
    logger.error("unified_reconciliation_failed", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
});
let unifiedReconciliation = createRuntimeUnifiedReconciliation();
const requestUnifiedBarrierFallback = () => {
  void unifiedAdmissionRuntimeControl.switchToBarrier().then((result) => {
    logger.warn("unified_admission_barrier_fallback", result);
  }).catch((error) => {
    logger.error("unified_admission_barrier_fallback_failed", {
      error: error instanceof Error ? error.message : String(error)
    });
  });
};
const unifiedRuntimeGate = createUnifiedRuntimeGate({
  startController: () => unifiedReconciliation.start(),
  wakeController: () => {
    unifiedRepairServiceTracker.recordWake();
    unifiedReconciliation.wake();
  },
  activateBarrierFallback: requestUnifiedBarrierFallback,
  registerBarrierFallback: (listener) => {
    if (process.platform !== "win32") process.on("SIGUSR2", listener);
  },
  unregisterBarrierFallback: (listener) => {
    if (process.platform !== "win32") process.off("SIGUSR2", listener);
  }
});
wakeUnifiedController = () => {
  unifiedRuntimeGate.wakeController();
};
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
    getUnifiedRunSnapshot: (runId) =>
      loadUnifiedAdminRunSnapshot(db, {
        runId,
        now: new Date(),
        decision: unifiedAdminRunDecisionStore.get(runId)
      }),
    getUnifiedAdaptiveSnapshot: () =>
      unifiedAdaptiveSnapshotPublisher.current(),
    getUnifiedProgress: (runId) => {
      const now = new Date();
      const pool = unifiedProviderPool.snapshot();
      const scheduler = tronscanScheduler.diagnostics();
      const groupIds = new Set([
        ...Object.keys(scheduler.dispatchedRequestsByAccountGroup),
        ...Object.keys(scheduler.inFlightByAccountGroup),
        ...Object.keys(scheduler.accountGroupCooldownUntilMs)
      ]);
      return loadUnifiedProgressProjection(db, {
        runId,
        now,
        configuredSlots: pool.targetSlots,
        keyGroups: [...groupIds].map((id) => {
          const inFlight = scheduler.inFlightByAccountGroup[id] ?? 0;
          const coolingDown =
            (scheduler.accountGroupCooldownUntilMs[id] ?? 0) > now.getTime();
          return {
            id,
            requests:
              scheduler.dispatchedRequestsByAccountGroup[id] ?? 0,
            inFlight,
            status: coolingDown
              ? "cooldown" as const
              : inFlight > 0
                ? "active" as const
                : "idle" as const
          };
        })
      });
    },
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
        traversalPolicyVersion: config.unifiedTraversalPolicyVersion,
        runtimeCommit: runtimeVersion.gitCommitSha,
        schemaVersion: SCHEMA_036_VERSION
      },
      rolloutPolicy: {
        stage: unifiedRolloutPolicy.stage,
        boundedUserCheckBasisPoints:
          config.unifiedRollingUserCheckBasisPoints,
        providerCapacityCeiling:
          unifiedRolloutPolicy.providerCapacityCeiling
      },
      freezeLabelDataset: freezeProductionLabelDataset,
      now: () => now
    });
    wakeUnifiedController();
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
  selectiveTransactionEnricher,
  listActiveRouteAssertions: selectiveRouteAssertions,
  listIndexedMovementsByHashes: indexedMovementsByHashes,
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
      selectiveTransactionEnricher,
      listActiveRouteAssertions: selectiveRouteAssertions,
      listIndexedMovementsByHashes: indexedMovementsByHashes,
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

function startBackgroundWorkSchedule(
  options: { readonly unifiedOnly?: boolean } = {}
): void {
  if (startupWorkSchedule || unifiedWorkSchedule) return;
  if (options.unifiedOnly !== true) {
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
  }
  unifiedRuntimeGate.start();
  const unifiedProviderWork = async () => undefined;
  // Provider, analysis/coordinator, and finalization are advanced by the
  // coalesced controller cycle. Periodic labels remain inert compatibility
  // entries so the startup schedule cannot create a second claimant loop.
  const unifiedAnalysisWork = async () => undefined;
  const unifiedFinalizationWork = async () => undefined;
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
    schedule: buildUnifiedResourceWorkSchedule().filter((item) =>
      item.label !== "unified_delivery" ||
      (
        !config.unifiedIsolatedWorkerOnly &&
        ownsWalletDelivery(activeCheckGeneration, "unified")
      )
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
  logger.info("startup_work_schedule_started", {
    isolatedWorkerOnly: options.unifiedOnly === true,
    schedule: options.unifiedOnly === true ? [] : startupWorkScheduleItems
  });
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  unifiedRuntimeGate.stop();
  logger.info("shutdown_started", { signal });
  startupWorkSchedule?.stop();
  startupWorkSchedule = null;
  unifiedWorkSchedule?.stop();
  unifiedWorkSchedule = null;
  if (unifiedCooldownWake !== null) {
    clearTimeout(unifiedCooldownWake);
    unifiedCooldownWake = null;
  }
  await unifiedReconciliation.stop();
  await unifiedProviderPool.drain();

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

if (config.unifiedIsolatedWorkerOnly) {
  logger.warn("unified_isolated_worker_only_started", {
    telegramPolling: false,
    telegramDelivery: false,
    legacySchedules: false
  });
  startBackgroundWorkSchedule({ unifiedOnly: true });
} else {
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
}
