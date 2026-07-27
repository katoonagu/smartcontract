import type {
  DeepSecondLayerContextV1,
  DeepSecondLayerRelationshipProfile,
  ForensicTelegramDeliveryV1,
  RecoveredForensicDeliveryIntentV1,
  WaitReconciliationResultV1
} from "../types";
import {
  fingerprintCanonicalJson,
  isForensicTelegramDeliveryV1,
  isRecoveredForensicDeliveryIntentV1
} from "./telegramDelivery";
import type { ForensicTelegramDeliveryJobKind } from "./telegramDelivery";
import { isWaitReconciliationResultV1 } from "./waitReconciliation";

export type ForensicJobPhase =
  | "queued"
  | "claimed"
  | "address_deep_trace"
  | "money_origin_trace"
  | "cross_chain_stage2"
  | "incoming_deposit_trace"
  | "risk_recording"
  | "notification_delivery"
  | "completing"
  | "queued_after_stale_recovery"
  | "failed_after_stale_recovery"
  | "selecting_flows"
  | "tracing_paths"
  | "checking_hop_coverage"
  | "checking_balance_forming_slice"
  | "indexing_hop_history"
  | "waiting_for_targeted_index"
  | "reading_local_index"
  | "scoring"
  | "provider_limited";

export type CrossChainStage2ProgressStatus =
  | "not_applicable"
  | "pending"
  | "running"
  | "skipped"
  | "partial"
  | "completed"
  | "failed";

export type CrossChainStage2Progress = {
  enabled: boolean;
  manualDeepMode: boolean;
  status: CrossChainStage2ProgressStatus;
  triggered?: boolean | null;
  reason?: string | null;
  selectedAmountRaw?: string | null;
  targetAmountRaw?: string | null;
  providerCalls?: number | null;
  updatedAt?: string | null;
};

export type ForensicJobProgressPatch = {
  jobPhase?: ForensicJobPhase;
  jobHeartbeatAt?: string;
  retryCount?: number;
  lastRecoveredAt?: string | null;
  staleRecoveryReason?: string | null;
  crossChainStage2Progress?: CrossChainStage2Progress;
  strictProvenance?: Record<string, unknown>;
  targetedIndex?: Record<string, unknown>;
  balanceFormingSlice?: Record<string, unknown>;
  strictBenchmarkMetrics?: Record<string, unknown>;
  performanceTiming?: Record<string, unknown>;
  telegramDelivery?: ForensicTelegramDeliveryV1 | null;
  telegramDeliveryIntent?: RecoveredForensicDeliveryIntentV1 | null;
  deepSecondLayerContext?: DeepSecondLayerContextV1 | null;
  waitReconciliation?: WaitReconciliationResultV1 | null;
};

export type ForensicEnrichmentProgress = (input: { completed: number; total: number }) => Promise<void>;
export type ForensicEnrichmentHeartbeatRunner = <T>(
  task: (onCandidateResolved: ForensicEnrichmentProgress) => Promise<T>
) => Promise<T>;

export type ForensicEnrichmentHeartbeatWrite = {
  kind: "periodic" | "progress" | "final";
  progress: { completed: number; total: number } | null;
};

export type ForensicEnrichmentHeartbeatCoordinator = {
  run: ForensicEnrichmentHeartbeatRunner;
  dispose(): Promise<void>;
};

export function createForensicEnrichmentHeartbeatCoordinator(input: {
  heartbeat(write: ForensicEnrichmentHeartbeatWrite): Promise<void>;
  intervalMs?: number;
  now?: () => number;
  isAborted?: () => boolean;
}): ForensicEnrichmentHeartbeatCoordinator {
  const intervalMs = Math.max(1, Math.floor(input.intervalMs ?? 30_000));
  const now = input.now ?? Date.now;
  let lastWriteStartedAt = Number.NEGATIVE_INFINITY;
  let writeInFlight: Promise<void> | null = null;
  let heartbeatFailure: unknown;
  let heartbeatFailed = false;
  let activeRuns = 0;
  let latestProgress: { completed: number; total: number } | null = null;
  let queuedFinal: { completed: number; total: number } | null = null;
  let queuedFinalWaiters: Array<() => void> = [];
  let disposed = false;
  const finishQueuedFinalWithoutWrite = (): void => {
    queuedFinal = null;
    const waiters = queuedFinalWaiters;
    queuedFinalWaiters = [];
    for (const resolve of waiters) resolve();
  };
  const startWrite = (write: ForensicEnrichmentHeartbeatWrite): Promise<void> => {
    lastWriteStartedAt = now();
    const pending = input.heartbeat(write).catch((error) => {
      heartbeatFailed = true;
      heartbeatFailure = error;
      finishQueuedFinalWithoutWrite();
    }).finally(() => {
      if (writeInFlight !== pending) return;
      writeInFlight = null;
      if (heartbeatFailed || disposed || input.isAborted?.()) {
        finishQueuedFinalWithoutWrite();
        return;
      }
      if (!queuedFinal) return;
      const progress = queuedFinal;
      const waiters = queuedFinalWaiters;
      queuedFinal = null;
      queuedFinalWaiters = [];
      void startWrite({ kind: "final", progress }).then(() => {
        for (const resolve of waiters) resolve();
      });
    });
    writeInFlight = pending;
    return pending;
  };
  const write = (
    force: boolean,
    progress: { completed: number; total: number } | null,
    kind: "periodic" | "progress"
  ): Promise<void> => {
    if (heartbeatFailed || disposed || input.isAborted?.()) return Promise.resolve();
    if (force && writeInFlight) {
      queuedFinal = progress;
      return new Promise<void>((resolve) => queuedFinalWaiters.push(resolve));
    }
    if (writeInFlight) return writeInFlight;
    const current = now();
    if (!force && current - lastWriteStartedAt < intervalMs) return Promise.resolve();
    return startWrite({ kind: force ? "final" : kind, progress });
  };
  const timer = setInterval(() => {
    if (activeRuns > 0) void write(false, latestProgress, "periodic");
  }, intervalMs);
  if (typeof timer === "object" && "unref" in timer && typeof timer.unref === "function") timer.unref();
  return {
    async run(task) {
      if (heartbeatFailed) throw heartbeatFailure;
      if (disposed || input.isAborted?.()) throw new Error("selective_transaction_enrichment_aborted");
      activeRuns += 1;
      try {
        const result = await task((progress) => {
          latestProgress = progress;
          return write(progress.completed === progress.total, progress, "progress");
        });
        if (heartbeatFailed) throw heartbeatFailure;
        return result;
      } finally {
        activeRuns -= 1;
      }
    },
    async dispose() {
      disposed = true;
      clearInterval(timer);
      finishQueuedFinalWithoutWrite();
      await writeInFlight;
    }
  };
}

export type ForensicRuntimeContractProjection = {
  telegramDelivery: ForensicTelegramDeliveryV1 | null;
  telegramDeliveryIntent: RecoveredForensicDeliveryIntentV1 | null;
  deepSecondLayerContext: DeepSecondLayerContextV1 | null;
  waitReconciliation: WaitReconciliationResultV1 | null;
};

export type DeepSecondLayerContextFingerprintBinding = {
  readonly jobKind?: ForensicTelegramDeliveryJobKind;
  readonly expectedSubjectAddress: string;
} & (
  | { readonly baseResult: unknown; readonly expectedBaseResultFingerprint?: never }
  | { readonly expectedBaseResultFingerprint: string; readonly baseResult?: never }
);

export type ForensicRuntimeContractBinding =
  | {
      readonly jobKind?: ForensicTelegramDeliveryJobKind;
      readonly expectedSubjectAddress?: never;
      readonly baseResult?: never;
      readonly expectedBaseResultFingerprint?: never;
    }
  | DeepSecondLayerContextFingerprintBinding;

export type ForensicJobRuntimeSummary = {
  phase: ForensicJobPhase | null;
  heartbeatAt: string | null;
  retryCount: number;
  lastRecoveredAt: string | null;
  staleRecoveryReason: string | null;
  crossChain: (Omit<CrossChainStage2Progress, "status"> & {
    status: CrossChainStage2ProgressStatus | null;
    triggered: boolean | null;
    reason: string | null;
    selectedAmountRaw: string | null;
    targetAmountRaw: string | null;
    providerCalls: number | null;
    updatedAt: string | null;
  }) | null;
};

const phases = new Set<ForensicJobPhase>([
  "queued",
  "claimed",
  "address_deep_trace",
  "money_origin_trace",
  "cross_chain_stage2",
  "incoming_deposit_trace",
  "risk_recording",
  "notification_delivery",
  "completing",
  "queued_after_stale_recovery",
  "failed_after_stale_recovery",
  "selecting_flows",
  "tracing_paths",
  "checking_hop_coverage",
  "checking_balance_forming_slice",
  "indexing_hop_history",
  "waiting_for_targeted_index",
  "reading_local_index",
  "scoring",
  "provider_limited"
]);

const crossChainStage2ProgressStatuses = new Set<CrossChainStage2ProgressStatus>([
  "not_applicable",
  "pending",
  "running",
  "skipped",
  "partial",
  "completed",
  "failed"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasExactOwnKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.length
    && keys.every((key) => typeof key === "string" && expected.includes(key));
}

function hasAllowedOwnKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = []
): boolean {
  const allowed = new Set([...required, ...optional]);
  const keys = Reflect.ownKeys(value);
  return keys.every((key) => typeof key === "string" && allowed.has(key))
    && required.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const RAW_AMOUNT_PATTERN = /^(0|[1-9][0-9]*)$/;
const MAX_CONTRACT_STRING_LENGTH = 4_096;
const MAX_IDENTIFIER_LENGTH = 512;
const MAX_RAW_AMOUNT_DIGITS = 78;
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_PROFILE_ARRAY_LENGTH = 10_000;
const deepWalletStatuses = new Set([
  "expanded",
  "grouped",
  "stopped_service_boundary",
  "stopped_high_degree",
  "no_meaningful_second_hop",
  "not_indexed",
  "queued"
]);
const deepStopReasons = new Set([
  "service_boundary",
  "high_degree",
  "index_not_complete",
  "no_meaningful_second_hop",
  "queued_for_indexing"
]);
const deepLimitationCodes = new Set([
  "deep_second_layer_service_boundary",
  "deep_second_layer_high_degree",
  "deep_second_layer_not_indexed",
  "deep_second_layer_no_meaningful_neighbor",
  "deep_second_layer_queued"
]);
const serviceCategories = new Set([
  "bridge",
  "bridge_pool",
  "dex",
  "router",
  "cex",
  "hot_wallet",
  "swap_adapter",
  "service",
  "protocol",
  "unknown_contract",
  "none"
]);
const deepGroupKinds = new Set([
  "low_signal_neighbors",
  "service_endpoints",
  "small_transfers",
  "high_degree_suppressed"
]);
const indexStatuses = new Set([
  "queued",
  "running",
  "complete",
  "partial",
  "failed_retryable",
  "failed_terminal",
  "not_requested"
]);
const indexProviders = new Set(["tronscan", "trongrid_fallback", "mixed"]);
const indexRequestKinds = new Set(["broad_targeted", "candidate_window"]);
const indexStatusReasons = new Set([
  "complete_provider_windowed",
  "partial_provider_cap",
  "partial_budget_exhausted",
  "partial_rate_limited",
  "partial_provider_inconsistent",
  "too_large_deferred",
  "failed_retryable",
  "failed_terminal"
]);
const deepIndexRequiredKeys = [
  "address",
  "coverageMode",
  "coverageKind",
  "status",
  "uniqueCounterpartyCount"
] as const;
const deepIndexOptionalKeys = [
  "statusReason",
  "fetchedTransferCount",
  "completedAt",
  "tokenContract",
  "provider",
  "totalReported",
  "newestTransferAt",
  "oldestTransferAt",
  "coveredUntilTimestamp",
  "targetTimestamp",
  "requestKind",
  "windowStartTimestamp",
  "windowEndTimestamp",
  "relatedHopTxHash",
  "candidateTxHash",
  "fetchedPageCount",
  "plannedPageCount",
  "currentEndTimestamp",
  "providerCapHit",
  "budgetExhausted",
  "providerInconsistent",
  "priority",
  "nextRunAt",
  "attemptCount",
  "maxAttempts",
  "retryCount",
  "lastError",
  "lastErrorClass",
  "lastSuccessfulPageAt",
  "queuedReason",
  "requestedByJobId",
  "lockedAt",
  "lockedUntil",
  "heartbeatAt",
  "lockOwner",
  "budgetPages",
  "budgetSeconds",
  "createdAt",
  "updatedAt",
  "claimPreviousStatus"
] as const;

function isBoundedNonEmptyString(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= MAX_CONTRACT_STRING_LENGTH;
}

function isBoundedIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_IDENTIFIER_LENGTH;
}

function isBoundedString(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_CONTRACT_STRING_LENGTH;
}

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isoTimestampMilliseconds(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value
    ? milliseconds
    : null;
}

function isOptionalBoundedString(value: unknown): boolean {
  return value === undefined || value === null || isBoundedNonEmptyString(value);
}

function isTimestamp(value: unknown): boolean {
  return value instanceof Date
    ? Number.isFinite(value.getTime())
    : isoTimestampMilliseconds(value) !== null;
}

function validatesPresentField(
  record: Record<string, unknown>,
  key: string,
  validator: (value: unknown) => boolean
): boolean {
  return !Object.prototype.hasOwnProperty.call(record, key) || validator(record[key]);
}

function isBoundedArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length <= MAX_PROFILE_ARRAY_LENGTH;
}

function validTimestampOrder(first: unknown, last: unknown): boolean {
  if (first === null && last === null) return true;
  if (isoTimestampMilliseconds(first) === null || isoTimestampMilliseconds(last) === null) return false;
  return (isoTimestampMilliseconds(first) as number) <= (isoTimestampMilliseconds(last) as number);
}

function isDeepIndexSummary(value: unknown): boolean {
  if (!isRecord(value)
    || !hasAllowedOwnKeys(value, deepIndexRequiredKeys, deepIndexOptionalKeys)
    || !isBoundedIdentifier(value.address)
    || (value.coverageMode !== null && value.coverageMode !== "all_time" && value.coverageMode !== "targeted")
    || (value.coverageKind !== null && value.coverageKind !== "provider_windowed")
    || typeof value.status !== "string"
    || !indexStatuses.has(value.status)
    || !isCount(value.uniqueCounterpartyCount)) {
    return false;
  }
  if (!validatesPresentField(value, "statusReason", (field) => field === null
      || (typeof field === "string" && indexStatusReasons.has(field)))
    || !validatesPresentField(value, "fetchedTransferCount", isCount)
    || !validatesPresentField(value, "completedAt", (field) => field === null || isTimestamp(field))
    || !validatesPresentField(value, "tokenContract", isBoundedIdentifier)
    || !validatesPresentField(value, "provider", (field) => field === null
      || (typeof field === "string" && indexProviders.has(field)))
    || !validatesPresentField(value, "totalReported", (field) => field === null || isCount(field))
    || !validatesPresentField(value, "requestKind", (field) => typeof field === "string"
      && indexRequestKinds.has(field))
    || !validatesPresentField(value, "relatedHopTxHash", (field) => field === null
      || isBoundedIdentifier(field))
    || !validatesPresentField(value, "candidateTxHash", (field) => field === null
      || isBoundedIdentifier(field))
    || !validatesPresentField(value, "plannedPageCount", (field) => field === null || isCount(field))
    || !validatesPresentField(value, "priority", (field) => Number.isSafeInteger(field))
    || !validatesPresentField(value, "lastError", (field) => field === null || isBoundedString(field))
    || !validatesPresentField(value, "lastErrorClass", (field) => field === null || isBoundedString(field))
    || !validatesPresentField(value, "queuedReason", (field) => field === null || isBoundedString(field))
    || !validatesPresentField(value, "requestedByJobId", (field) => field === null
      || isBoundedIdentifier(field))
    || !validatesPresentField(value, "lockOwner", (field) => field === null
      || isBoundedIdentifier(field))
    || !validatesPresentField(value, "claimPreviousStatus", (field) => field === null
      || (typeof field === "string" && field !== "not_requested" && indexStatuses.has(field)))) {
    return false;
  }
  for (const key of [
    "fetchedPageCount",
    "attemptCount",
    "maxAttempts",
    "retryCount"
  ]) {
    if (!validatesPresentField(value, key, isCount)) return false;
  }
  for (const key of ["budgetPages", "budgetSeconds"]) {
    if (!validatesPresentField(value, key, (field) => field === null || isCount(field))) return false;
  }
  for (const key of ["providerCapHit", "budgetExhausted", "providerInconsistent"]) {
    if (!validatesPresentField(value, key, (field) => typeof field === "boolean")) return false;
  }
  for (const key of [
    "newestTransferAt",
    "oldestTransferAt",
    "coveredUntilTimestamp",
    "targetTimestamp",
    "windowStartTimestamp",
    "windowEndTimestamp",
    "currentEndTimestamp",
    "lastSuccessfulPageAt",
    "lockedAt",
    "lockedUntil",
    "heartbeatAt"
  ]) {
    if (!validatesPresentField(value, key, (field) => field === null || isTimestamp(field))) return false;
  }
  for (const key of ["nextRunAt", "createdAt", "updatedAt"]) {
    if (!validatesPresentField(value, key, isTimestamp)) return false;
  }
  return true;
}

function isDeepDirectWalletStatus(value: unknown): boolean {
  if (!isRecord(value)
    || !hasAllowedOwnKeys(value, [
      "address",
      "status",
      "stopReason",
      "limitationCode",
      "queued",
      "savedPathCount",
      "groupedNeighborCount"
    ], ["serviceCategory", "identity", "index"])
    || !isBoundedIdentifier(value.address)
    || typeof value.status !== "string"
    || !deepWalletStatuses.has(value.status)
    || (value.stopReason !== null
      && (typeof value.stopReason !== "string" || !deepStopReasons.has(value.stopReason)))
    || (value.limitationCode !== null
      && (typeof value.limitationCode !== "string" || !deepLimitationCodes.has(value.limitationCode)))
    || typeof value.queued !== "boolean"
    || !isCount(value.savedPathCount)
    || !isCount(value.groupedNeighborCount)
    || !isOptionalBoundedString(value.identity)) {
    return false;
  }
  if (value.serviceCategory !== undefined
    && value.serviceCategory !== null
    && (typeof value.serviceCategory !== "string" || !serviceCategories.has(value.serviceCategory))) {
    return false;
  }
  return value.index === undefined || value.index === null || isDeepIndexSummary(value.index);
}

function parseRawAmount(value: unknown, maxDigits: number): bigint | null {
  return typeof value === "string"
    && value.length <= maxDigits
    && RAW_AMOUNT_PATTERN.test(value)
    ? BigInt(value)
    : null;
}

function isScalarRawAmount(value: unknown): value is string {
  const amount = parseRawAmount(value, MAX_RAW_AMOUNT_DIGITS);
  return amount !== null && amount <= MAX_UINT256;
}

function isAggregateRawAmount(value: unknown, txCount: unknown): value is string {
  if (!isCount(txCount)) return false;
  const maxAmount = MAX_UINT256 * BigInt(txCount);
  const amount = parseRawAmount(value, maxAmount.toString().length);
  return amount !== null && amount <= maxAmount;
}

function isDeepPathEvidence(value: unknown): boolean {
  return isRecord(value)
    && hasExactOwnKeys(value, ["txHash", "fromAddress", "toAddress", "amountRaw", "timestamp"])
    && isBoundedIdentifier(value.txHash)
    && isBoundedIdentifier(value.fromAddress)
    && isBoundedIdentifier(value.toAddress)
    && (value.amountRaw === null || isScalarRawAmount(value.amountRaw))
    && (value.timestamp === null || isoTimestampMilliseconds(value.timestamp) !== null);
}

function isDeepRelationshipPath(value: unknown): boolean {
  if (!isRecord(value)
    || !hasExactOwnKeys(value, [
      "id",
      "source",
      "depth",
      "subjectAddress",
      "directWalletAddress",
      "secondHopAddress",
      "pathAddresses",
      "txHashes",
      "txCount",
      "amountRaw",
      "firstSeen",
      "lastSeen",
      "tokenContract",
      "assetSymbol",
      "evidence",
      "selectionReason"
    ])
    || !isBoundedIdentifier(value.id)
    || value.source !== "deepcheck_relationship_second_hop"
    || value.depth !== 2
    || !isBoundedIdentifier(value.subjectAddress)
    || !isBoundedIdentifier(value.directWalletAddress)
    || !isBoundedIdentifier(value.secondHopAddress)
    || !Array.isArray(value.pathAddresses)
    || value.pathAddresses.length !== 3
    || !value.pathAddresses.every(isBoundedIdentifier)
    || value.pathAddresses[0] !== value.subjectAddress
    || value.pathAddresses[1] !== value.directWalletAddress
    || value.pathAddresses[2] !== value.secondHopAddress
    || !isBoundedArray(value.txHashes)
    || !value.txHashes.every(isBoundedIdentifier)
    || !isCount(value.txCount)
    || value.txCount !== value.txHashes.length
    || !isAggregateRawAmount(value.amountRaw, value.txCount)
    || !validTimestampOrder(value.firstSeen, value.lastSeen)
    || (value.tokenContract !== null && !isBoundedIdentifier(value.tokenContract))
    || (value.assetSymbol !== null && !isBoundedIdentifier(value.assetSymbol))
    || !isBoundedArray(value.evidence)
    || !value.evidence.every(isDeepPathEvidence)
    || value.selectionReason !== "top_amount_or_activity") {
    return false;
  }
  const directWalletAddress = value.directWalletAddress.trim().toLowerCase();
  const secondHopAddress = value.secondHopAddress.trim().toLowerCase();
  const txHashes = value.txHashes as string[];
  if (value.evidence.length !== txHashes.length) return false;
  let evidenceAmount = 0n;
  let firstSeen: string | null = null;
  let lastSeen: string | null = null;
  for (const [index, evidence] of value.evidence.entries()) {
    const record = evidence as Record<string, unknown>;
    const fromAddress = (record.fromAddress as string).trim().toLowerCase();
    const toAddress = (record.toAddress as string).trim().toLowerCase();
    if (record.txHash !== txHashes[index]
      || !((fromAddress === directWalletAddress && toAddress === secondHopAddress)
        || (fromAddress === secondHopAddress && toAddress === directWalletAddress))) {
      return false;
    }
    if (typeof record.amountRaw === "string") {
      evidenceAmount += BigInt(record.amountRaw);
      if (evidenceAmount > MAX_UINT256 * BigInt(txHashes.length)) return false;
    }
    if (typeof record.timestamp === "string") {
      const timestamp = record.timestamp;
      if (firstSeen === null || timestamp.localeCompare(firstSeen) < 0) firstSeen = timestamp;
      if (lastSeen === null || timestamp.localeCompare(lastSeen) > 0) lastSeen = timestamp;
    }
  }
  return evidenceAmount === BigInt(value.amountRaw as string)
    && value.firstSeen === firstSeen
    && value.lastSeen === lastSeen;
}

function isDeepRelationshipGroup(value: unknown): boolean {
  return isRecord(value)
    && hasExactOwnKeys(value, [
      "id",
      "kind",
      "label",
      "subjectAddress",
      "directWalletAddress",
      "memberCount",
      "members",
      "txCount",
      "amountRaw",
      "firstSeen",
      "lastSeen"
    ])
    && isBoundedIdentifier(value.id)
    && typeof value.kind === "string"
    && deepGroupKinds.has(value.kind)
    && isBoundedNonEmptyString(value.label)
    && isBoundedIdentifier(value.subjectAddress)
    && isBoundedIdentifier(value.directWalletAddress)
    && isCount(value.memberCount)
    && isBoundedArray(value.members)
    && value.memberCount === value.members.length
    && value.members.every(isBoundedIdentifier)
    && isCount(value.txCount)
    && isAggregateRawAmount(value.amountRaw, value.txCount)
    && validTimestampOrder(value.firstSeen, value.lastSeen);
}

function hasCountFields(value: unknown, fields: readonly string[]): boolean {
  return isRecord(value)
    && hasExactOwnKeys(value, fields)
    && fields.every((field) => isCount(value[field]));
}

function hasCompleteAllTimeIndex(status: Record<string, unknown>): boolean {
  return isRecord(status.index)
    && status.index.coverageMode === "all_time"
    && status.index.coverageKind === "provider_windowed"
    && status.index.status === "complete";
}

function hasDeepStatusSemantics(
  status: Record<string, unknown>,
  hasQueueRequest: boolean,
  highDegreeSuppressionThreshold: number
): boolean {
  const noSavedRelationships = status.savedPathCount === 0 && status.groupedNeighborCount === 0;
  const completeIndex = hasCompleteAllTimeIndex(status);
  switch (status.status) {
    case "queued":
      return status.queued === true
        && status.stopReason === "queued_for_indexing"
        && status.limitationCode === "deep_second_layer_queued"
        && !completeIndex
        && hasQueueRequest
        && noSavedRelationships;
    case "not_indexed":
      return status.queued === false
        && status.stopReason === "index_not_complete"
        && status.limitationCode === "deep_second_layer_not_indexed"
        && !completeIndex
        && hasQueueRequest
        && noSavedRelationships;
    case "stopped_high_degree":
      return status.queued === false
        && status.stopReason === "high_degree"
        && status.limitationCode === "deep_second_layer_high_degree"
        && !hasQueueRequest
        && noSavedRelationships
        && completeIndex
        && isRecord(status.index)
        && (status.index.uniqueCounterpartyCount as number) >= highDegreeSuppressionThreshold;
    case "stopped_service_boundary":
      return status.queued === false
        && status.stopReason === "service_boundary"
        && status.limitationCode === "deep_second_layer_service_boundary"
        && !hasQueueRequest
        && noSavedRelationships
        && status.index == null
        && typeof status.serviceCategory === "string"
        && status.serviceCategory !== "none";
    case "no_meaningful_second_hop":
      return status.queued === false
        && status.stopReason === "no_meaningful_second_hop"
        && status.limitationCode === "deep_second_layer_no_meaningful_neighbor"
        && !hasQueueRequest
        && noSavedRelationships
        && completeIndex;
    case "expanded":
      return status.queued === false
        && status.stopReason === null
        && status.limitationCode === null
        && !hasQueueRequest
        && completeIndex
        && (status.savedPathCount as number) > 0
        && status.groupedNeighborCount === 0;
    case "grouped":
      return status.queued === false
        && status.stopReason === null
        && status.limitationCode === null
        && !hasQueueRequest
        && completeIndex
        && (status.groupedNeighborCount as number) > 0;
    default:
      return false;
  }
}

export function isDeepSecondLayerRelationshipProfile(
  value: unknown,
  expectedSubjectAddress?: string
): value is DeepSecondLayerRelationshipProfile {
  if (!isRecord(value)
    || !hasExactOwnKeys(value, [
      "version",
      "source",
      "subjectAddress",
      "generatedAt",
      "limits",
      "directWalletStatuses",
      "paths",
      "groups",
      "queueRequests",
      "counters"
    ])
    || value.version !== 1
    || value.source !== "deepcheck_relationship_expansion_v1"
    || !isBoundedIdentifier(value.subjectAddress)
    || (expectedSubjectAddress !== undefined && value.subjectAddress !== expectedSubjectAddress)
    || isoTimestampMilliseconds(value.generatedAt) === null
    || !hasCountFields(value.limits, [
      "maxDirectWalletsConsidered",
      "maxExpandedDirectWallets",
      "maxSecondHopNeighborsPerDirectWallet",
      "maxTotalSecondHopEdges",
      "highDegreeSuppressionThreshold"
    ])
    || !hasCountFields(value.counters, [
      "directWalletsConsidered",
      "expanded",
      "grouped",
      "stopped",
      "notIndexed",
      "queued",
      "complete",
      "paths",
      "groups",
      "maxSavedDepth"
    ])
    || !isBoundedArray(value.directWalletStatuses)
    || !value.directWalletStatuses.every(isDeepDirectWalletStatus)
    || !isBoundedArray(value.paths)
    || !value.paths.every(isDeepRelationshipPath)
    || !isBoundedArray(value.groups)
    || !value.groups.every(isDeepRelationshipGroup)
    || !isBoundedArray(value.queueRequests)
    || !value.queueRequests.every((request) => isRecord(request)
      && hasExactOwnKeys(request, ["address", "coverageMode", "queuedReason"])
      && isBoundedIdentifier(request.address)
      && request.coverageMode === "all_time"
      && request.queuedReason === "deep_second_layer")) {
    return false;
  }
  const counters = value.counters as Record<string, unknown>;
  const statuses = value.directWalletStatuses as Array<Record<string, unknown>>;
  const countStatus = (...expected: string[]) => statuses.filter((status) =>
    typeof status.status === "string" && expected.includes(status.status)).length;
  const maxSavedDepth = value.paths.length === 0
    ? 0
    : Math.max(...(value.paths as Array<Record<string, unknown>>).map((path) => path.depth as number));
  const directWalletsConsidered = counters.directWalletsConsidered as number;
  const maxDirectWalletsConsidered = (value.limits as Record<string, unknown>)
    .maxDirectWalletsConsidered as number;
  const complete = counters.complete as number;
  const maxExpandedDirectWallets = (value.limits as Record<string, unknown>)
    .maxExpandedDirectWallets as number;
  const maxSecondHopNeighborsPerDirectWallet = (value.limits as Record<string, unknown>)
    .maxSecondHopNeighborsPerDirectWallet as number;
  const maxTotalSecondHopEdges = (value.limits as Record<string, unknown>)
    .maxTotalSecondHopEdges as number;
  const highDegreeSuppressionThreshold = (value.limits as Record<string, unknown>)
    .highDegreeSuppressionThreshold as number;
  const statusByAddress = new Map(statuses.map((status) => [status.address as string, status]));
  if (statusByAddress.size !== statuses.length) return false;
  const queueRequests = value.queueRequests as Array<Record<string, unknown>>;
  const queueRequestAddresses = new Set(queueRequests.map((request) => request.address as string));
  if (queueRequestAddresses.size !== queueRequests.length) return false;

  const paths = value.paths as Array<Record<string, unknown>>;
  const groups = value.groups as Array<Record<string, unknown>>;
  const pathsByDirect = new Map<string, number>();
  const groupedNeighborsByDirect = new Map<string, number>();
  for (const path of paths) {
    const directWalletAddress = path.directWalletAddress as string;
    if (path.subjectAddress !== value.subjectAddress || !statusByAddress.has(directWalletAddress)) {
      return false;
    }
    pathsByDirect.set(directWalletAddress, (pathsByDirect.get(directWalletAddress) ?? 0) + 1);
  }
  for (const group of groups) {
    const directWalletAddress = group.directWalletAddress as string;
    if (group.subjectAddress !== value.subjectAddress || !statusByAddress.has(directWalletAddress)) {
      return false;
    }
    groupedNeighborsByDirect.set(
      directWalletAddress,
      (groupedNeighborsByDirect.get(directWalletAddress) ?? 0) + (group.memberCount as number)
    );
  }
  for (const status of statuses) {
    const address = status.address as string;
    if (status.savedPathCount !== (pathsByDirect.get(address) ?? 0)
      || status.groupedNeighborCount !== (groupedNeighborsByDirect.get(address) ?? 0)
      || (isRecord(status.index) && status.index.address !== address)
      || (pathsByDirect.get(address) ?? 0) > maxSecondHopNeighborsPerDirectWallet
      || !hasDeepStatusSemantics(
        status,
        queueRequestAddresses.has(address),
        highDegreeSuppressionThreshold
      )) {
      return false;
    }
  }
  for (const request of queueRequests) {
    const status = statusByAddress.get(request.address as string);
    if (!status || (status.status !== "not_indexed" && status.status !== "queued")) return false;
  }

  return statuses.length <= maxDirectWalletsConsidered
    && paths.length <= maxTotalSecondHopEdges
    && directWalletsConsidered >= statuses.length
    && directWalletsConsidered <= maxDirectWalletsConsidered
    && complete <= maxExpandedDirectWallets
    && (directWalletsConsidered === statuses.length || complete === maxExpandedDirectWallets)
    && counters.expanded === countStatus("expanded")
    && counters.grouped === countStatus("grouped")
    && counters.stopped === countStatus("stopped_service_boundary", "stopped_high_degree")
    && counters.notIndexed === countStatus("not_indexed")
    && counters.queued === countStatus("queued")
    && counters.complete === countStatus("expanded", "grouped", "no_meaningful_second_hop")
    && counters.paths === value.paths.length
    && counters.groups === value.groups.length
    && counters.maxSavedDepth === maxSavedDepth;
}

function expectedBaseResultFingerprint(
  binding: DeepSecondLayerContextFingerprintBinding | undefined
): string | null {
  if (!binding) return null;
  const hasBaseResult = Object.prototype.hasOwnProperty.call(binding, "baseResult");
  const hasExpectedFingerprint = Object.prototype.hasOwnProperty.call(
    binding,
    "expectedBaseResultFingerprint"
  );
  if (hasBaseResult === hasExpectedFingerprint) return null;
  if (hasBaseResult) {
    try {
      return fingerprintCanonicalJson(binding.baseResult);
    } catch {
      return null;
    }
  }
  return typeof binding.expectedBaseResultFingerprint === "string"
    && SHA256_PATTERN.test(binding.expectedBaseResultFingerprint)
    ? binding.expectedBaseResultFingerprint
    : null;
}

function deepContextBinding(
  binding: ForensicRuntimeContractBinding | undefined
): DeepSecondLayerContextFingerprintBinding | undefined {
  return binding && Object.prototype.hasOwnProperty.call(binding, "expectedSubjectAddress")
    ? binding as DeepSecondLayerContextFingerprintBinding
    : undefined;
}

export function isDeepSecondLayerContextV1(
  value: unknown,
  binding?: DeepSecondLayerContextFingerprintBinding
): value is DeepSecondLayerContextV1 {
  const expectedFingerprint = expectedBaseResultFingerprint(binding);
  if (!isRecord(value)
    || !hasExactOwnKeys(value, ["version", "baseResultFingerprint", "refreshedAt", "profile"])
    || value.version !== "deep-second-layer-context-v1"
    || typeof value.baseResultFingerprint !== "string"
    || !SHA256_PATTERN.test(value.baseResultFingerprint)
    || expectedFingerprint === null
    || value.baseResultFingerprint !== expectedFingerprint
    || !isBoundedIdentifier(binding?.expectedSubjectAddress)
    || !isDeepSecondLayerRelationshipProfile(value.profile, binding.expectedSubjectAddress)) {
    return false;
  }
  const refreshedAt = isoTimestampMilliseconds(value.refreshedAt);
  const generatedAt = isoTimestampMilliseconds(value.profile.generatedAt);
  return refreshedAt !== null && generatedAt !== null && refreshedAt >= generatedAt;
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberField(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanField(record: Record<string, unknown>, key: string): boolean | null {
  const value = record[key];
  return typeof value === "boolean" ? value : null;
}

export function parseForensicJobPhase(value: unknown): ForensicJobPhase | null {
  return typeof value === "string" && phases.has(value as ForensicJobPhase)
    ? (value as ForensicJobPhase)
    : null;
}

export function parseCrossChainStage2ProgressStatus(
  value: unknown
): CrossChainStage2ProgressStatus | null {
  return typeof value === "string" &&
    crossChainStage2ProgressStatuses.has(value as CrossChainStage2ProgressStatus)
    ? (value as CrossChainStage2ProgressStatus)
    : null;
}

export function mergeForensicJobProgress(
  base: Record<string, unknown>,
  patch: ForensicJobProgressPatch,
  now: Date = new Date(),
  contractBinding?: ForensicRuntimeContractBinding
): Record<string, unknown> {
  const contractValidators = {
    telegramDelivery: (value: unknown) => isForensicTelegramDeliveryV1(
      value,
      contractBinding?.jobKind
    ),
    telegramDeliveryIntent: isRecoveredForensicDeliveryIntentV1,
    deepSecondLayerContext: (value: unknown) => isDeepSecondLayerContextV1(
      value,
      deepContextBinding(contractBinding)
    ),
    waitReconciliation: isWaitReconciliationResultV1
  } as const;
  for (const [field, validator] of Object.entries(contractValidators)) {
    if (Object.prototype.hasOwnProperty.call(patch, field)) {
      const value = patch[field as keyof typeof contractValidators];
      if (value !== null && !validator(value)) {
        throw new TypeError(`Invalid ${field} progress contract`);
      }
    }
  }

  const heartbeat = patch.jobHeartbeatAt ?? now.toISOString();
  const baseCrossChain = isRecord(base.crossChainStage2Progress)
    ? base.crossChainStage2Progress
    : undefined;
  const crossChain = (baseCrossChain || patch.crossChainStage2Progress)
    ? {
        ...(baseCrossChain ?? {}),
        ...(patch.crossChainStage2Progress ?? {}),
        updatedAt:
          patch.crossChainStage2Progress?.updatedAt ??
          baseCrossChain?.updatedAt ??
          heartbeat
      }
    : undefined;
  const strictProvenance =
    isRecord(base.strictProvenance) || patch.strictProvenance
      ? {
          ...(isRecord(base.strictProvenance) ? base.strictProvenance : {}),
          ...(patch.strictProvenance ?? {})
        }
      : undefined;
  const baseStrictBenchmarkMetrics = isRecord(base.strictBenchmarkMetrics)
    ? base.strictBenchmarkMetrics
    : undefined;
  const patchStrictBenchmarkMetrics = isRecord(patch.strictBenchmarkMetrics)
    ? patch.strictBenchmarkMetrics
    : undefined;
  const baseStrictBenchmarkTotal = isRecord(baseStrictBenchmarkMetrics?.total)
    ? baseStrictBenchmarkMetrics.total
    : undefined;
  const patchStrictBenchmarkTotal = isRecord(patchStrictBenchmarkMetrics?.total)
    ? patchStrictBenchmarkMetrics.total
    : undefined;
  const baseStrictBenchmarkStages = isRecord(baseStrictBenchmarkMetrics?.stages)
    ? baseStrictBenchmarkMetrics.stages
    : undefined;
  const patchStrictBenchmarkStages = isRecord(patchStrictBenchmarkMetrics?.stages)
    ? patchStrictBenchmarkMetrics.stages
    : undefined;
  const strictBenchmarkMetrics =
    baseStrictBenchmarkMetrics || patchStrictBenchmarkMetrics
      ? {
          ...(baseStrictBenchmarkMetrics ?? {}),
          ...(patchStrictBenchmarkMetrics ?? {}),
          ...(baseStrictBenchmarkTotal || patchStrictBenchmarkTotal
            ? { total: { ...(baseStrictBenchmarkTotal ?? {}), ...(patchStrictBenchmarkTotal ?? {}) } }
            : {}),
          ...(baseStrictBenchmarkStages || patchStrictBenchmarkStages
            ? { stages: { ...(baseStrictBenchmarkStages ?? {}), ...(patchStrictBenchmarkStages ?? {}) } }
            : {})
        }
      : undefined;

  return {
    ...base,
    ...patch,
    jobHeartbeatAt: heartbeat,
    ...(crossChain ? { crossChainStage2Progress: crossChain } : {}),
    ...(strictProvenance ? { strictProvenance } : {}),
    ...(strictBenchmarkMetrics ? { strictBenchmarkMetrics } : {})
  };
}

export function buildForensicJobRuntimeSummary(progressJson: unknown): ForensicJobRuntimeSummary {
  const progress = isRecord(progressJson) ? progressJson : {};
  const phase = parseForensicJobPhase(progress.jobPhase);
  const retryCount = Math.max(0, Math.floor(numberField(progress, "retryCount") ?? 0));
  const rawCrossChain = isRecord(progress.crossChainStage2Progress)
    ? progress.crossChainStage2Progress
    : null;
  const crossChain = rawCrossChain
    ? {
        enabled: booleanField(rawCrossChain, "enabled") ?? false,
        manualDeepMode: booleanField(rawCrossChain, "manualDeepMode") ?? false,
        status: parseCrossChainStage2ProgressStatus(rawCrossChain.status),
        triggered: booleanField(rawCrossChain, "triggered"),
        reason: stringField(rawCrossChain, "reason"),
        selectedAmountRaw: stringField(rawCrossChain, "selectedAmountRaw"),
        targetAmountRaw: stringField(rawCrossChain, "targetAmountRaw"),
        providerCalls: numberField(rawCrossChain, "providerCalls"),
        updatedAt: stringField(rawCrossChain, "updatedAt")
      }
    : null;

  return {
    phase,
    heartbeatAt: stringField(progress, "jobHeartbeatAt"),
    retryCount,
    lastRecoveredAt: stringField(progress, "lastRecoveredAt"),
    staleRecoveryReason: stringField(progress, "staleRecoveryReason"),
    crossChain
  };
}

export function buildForensicRuntimeContractProjection(
  progressJson: unknown,
  contractBinding?: ForensicRuntimeContractBinding
): ForensicRuntimeContractProjection {
  const progress = isRecord(progressJson) ? progressJson : {};
  return {
    telegramDelivery: isForensicTelegramDeliveryV1(
      progress.telegramDelivery,
      contractBinding?.jobKind
    )
      ? progress.telegramDelivery
      : null,
    telegramDeliveryIntent: isRecoveredForensicDeliveryIntentV1(progress.telegramDeliveryIntent)
      ? progress.telegramDeliveryIntent
      : null,
    deepSecondLayerContext: isDeepSecondLayerContextV1(
      progress.deepSecondLayerContext,
      deepContextBinding(contractBinding)
    )
      ? progress.deepSecondLayerContext
      : null,
    waitReconciliation: isWaitReconciliationResultV1(progress.waitReconciliation)
      ? progress.waitReconciliation
      : null
  };
}

export function isIncomingDeliverySensitivePhase(phase: ForensicJobPhase | null): boolean {
  return phase === null || phase === "notification_delivery" || phase === "completing";
}
