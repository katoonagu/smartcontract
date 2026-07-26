import "dotenv/config";
import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig } from "../src/config";
import { createLegacyWhereIsMoneyExecution, type DeepForensicJobRunnerDeps } from "../src/forensics/deepForensicJob";
import { createEvmContinuationProvider } from "../src/forensics/evmContinuationProvider";
import { createEtherscanV2EvmEvidenceProvider } from "../src/forensics/evmExplorerClient";
import { canonicalizeArtifactJson } from "../src/forensics/canonicalJson";
import { createRangeCrossChainDiscoveryProvider, RANGE_ENDPOINT_PATHS } from "../src/forensics/rangeClient";
import { createTronUsdtContinuationProvider } from "../src/forensics/tronContinuationProvider";
import {
  buildWhereLatencyReplayV1,
  collectRouteCriticalAddresses,
  collectRouteCriticalTransactionHashes,
  LEGACY_WHERE_REPLAY_BASELINE_COMMIT,
  projectStableWhereFacts,
  recordWhereIsMoneyDependencies
} from "../src/forensics/whereLatencyReplay";
import { deepForensicRuntimeOptions } from "../src/runtime/deepForensicRuntimeOptions";
import { closeDb, createDb } from "../src/storage/db";
import {
  getAddressMetadata,
  getContractIntelligenceProfile,
  getCoveringTronAddressUsdtIndexState,
  getTronAddressUsdtIndexState,
  listActiveAddressLabelAssertionsForRoute,
  listAddressLabels,
  listIndexedTronUsdtTransfersByHashes,
  listIndexedTronUsdtTransfersForAddress,
  markWaitingForensicJobsReadyAfterTargetedIndex,
  queueTronAddressUsdtIndexState,
  releaseForensicCheckJobToWaiting,
  updateForensicCheckJobProgress,
  upsertForensicJobWait
} from "../src/storage/repositories";
import type { ForensicCheckJob } from "../src/storage/repositories";
import { TronscanClient } from "../src/tron/tronClient";
import { createTronscanScheduler } from "../src/tron/tronscanScheduler";
import type { IndexedTronUsdtTransfer, WhereIsMoneyReport } from "../src/types";

type JsonRecord = Record<string, unknown>;
type TapeEntry = { method: string; args: unknown[]; response: unknown; origin?: "legacy_observed" | "supplemental_stage_b_fixture"; invocationCount?: number };

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

function requiredString(value: unknown, code: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(code);
  return value;
}

function recordField(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function nonSecretConfig(config: Record<string, unknown>): Record<string, unknown> {
  const visible = Object.fromEntries(Object.entries(config).filter(([key]) =>
    !/(?:api[_-]?key|database|chat|telegram|token|secret|password)/i.test(key)
  ));
  return visible;
}

function nonSecretConfigHash(config: Record<string, unknown>, options: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalizeArtifactJson({ config: nonSecretConfig(config), options })).digest("hex");
}

function indexedSnapshotRow(row: IndexedTronUsdtTransfer): Record<string, unknown> {
  return {
    transferId: row.transferId ?? null,
    txHash: row.txHash,
    blockNumber: row.blockNumber,
    blockTimestamp: row.blockTimestamp.toISOString(),
    eventIndex: row.eventIndex,
    provider: row.provider ?? null,
    providerRowOrdinalInTx: row.providerRowOrdinalInTx ?? null,
    fromAddress: row.fromAddress,
    toAddress: row.toAddress,
    amountRaw: row.amountRaw,
    method: row.method,
    eventType: row.eventType ?? null,
    callerAddress: row.callerAddress,
    contractRet: row.contractRet,
    finalResult: row.finalResult ?? null,
    reverted: row.reverted ?? false,
    riskTransaction: row.riskTransaction ?? false,
    confirmed: row.confirmed
  };
}

async function writeReplayExclusive(path: string, bytes: string): Promise<void> {
  const file = await open(resolve(path), "wx");
  try {
    await file.writeFile(bytes, "utf8");
  } finally {
    await file.close();
  }
}

async function withFrozenClock<T>(iso: string, operation: () => Promise<T>): Promise<T> {
  const fixed = new Date(iso).getTime();
  const RealDate = Date;
  class FrozenDate extends RealDate {
    constructor(...args: ConstructorParameters<typeof Date>) {
      super(args.length === 0 ? fixed : args[0] as string | number | Date);
    }
    static now(): number { return fixed; }
  }
  Object.setPrototypeOf(FrozenDate, RealDate);
  globalThis.Date = FrozenDate as DateConstructor;
  try {
    return await operation();
  } finally {
    globalThis.Date = RealDate;
  }
}

const positional = process.argv.slice(2).filter((value) => !value.startsWith("--"));
const source = argument("--source") ?? positional[0] ?? null;
const output = argument("--out") ?? positional[1] ?? null;
if (!source || !output) throw new Error("Usage: forensic:where-latency:capture -- --source <TRON-address> --out <new-json-file>");

const config = loadConfig();
const db = createDb(config.databaseUrl);
try {
  const selected = await db.query(
    `select id, subject_address, window_start, window_end, progress_json, result_json, completed_at
     from forensic_check_jobs
     where kind = 'where_is_money_check' and status = 'completed' and subject_address = $1
     order by completed_at desc nulls last, updated_at desc
     limit 1`,
    [source]
  );
  const job = selected.rows[0] as Record<string, unknown> | undefined;
  if (!job) throw new Error("where_latency_replay_completed_legacy_job_missing");
  const progress = recordField(job.progress_json);
  const result = recordField(job.result_json);
  const savedReport = result.whereIsMoneyReport as WhereIsMoneyReport | undefined;
  if (!savedReport) throw new Error("where_latency_replay_completed_report_missing");
  const jobSource = requiredString(job.subject_address, "where_latency_replay_job_source_missing");
  const windowStart = new Date(requiredString(job.window_start, "where_latency_replay_job_window_missing"));
  const windowEnd = new Date(requiredString(job.window_end, "where_latency_replay_job_window_missing"));
  const completedAt = new Date(requiredString(job.completed_at, "where_latency_replay_job_completed_at_missing"));
  if (!Number.isFinite(windowStart.getTime()) || !Number.isFinite(windowEnd.getTime()) || !Number.isFinite(completedAt.getTime()) || windowStart >= windowEnd) {
    throw new Error("where_latency_replay_job_window_invalid");
  }

  const scheduler = createTronscanScheduler({
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
    accountGroupRequestMinIntervalMs: config.tronscanAccountGroupRequestMinIntervalMs
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
    scheduler,
    schedulerDedupeNamespace: `where-latency:${String(job.id)}`
  });
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

  const tape: TapeEntry[] = [];
  const tapeByRequest = new Map<string, TapeEntry>();
  const observedTransactions = new Set<string>();
  const baselineRequestCounts: Record<string, number> = {};
  const record = async <T>(method: string, args: unknown[], operation: () => Promise<T>, origin: TapeEntry["origin"] = "legacy_observed"): Promise<T> => {
    const request = canonicalizeArtifactJson({ method, args: JSON.parse(JSON.stringify(args)) });
    baselineRequestCounts[method] = (baselineRequestCounts[method] ?? 0) + 1;
    const existing = tapeByRequest.get(request);
    if (existing) {
      existing.invocationCount = (existing.invocationCount ?? 1) + 1;
      return structuredClone(existing.response) as T;
    }
    const response = await operation();
    if (method === "getTransaction" && typeof args[0] === "string") {
      const identity = recordField(response).txID ?? recordField(response).hash ?? recordField(response).id;
      if (typeof identity !== "string" || identity.toLowerCase() !== args[0].toLowerCase()) {
        throw new Error("where_latency_replay_transaction_info_identity_mismatch");
      }
    }
    const entry = { method, args: JSON.parse(JSON.stringify(args)), response: JSON.parse(JSON.stringify(response)), origin, invocationCount: 1 };
    tape.push(entry);
    tapeByRequest.set(request, entry);
    if (method === "getTransaction" && typeof args[0] === "string") observedTransactions.add(args[0]);
    return response;
  };
  const runtimeOptions = deepForensicRuntimeOptions(config, config.tronscanApiKeys.length > 0);
  const runtimeJob: ForensicCheckJob = {
    id: requiredString(job.id, "where_latency_replay_job_id_missing"),
    kind: "where_is_money_check",
    subjectAddress: jobSource,
    status: "completed",
    windowStart,
    windowEnd,
    priority: 0,
    chatId: null,
    messageId: null,
    requestedBy: null,
    progressJson: progress,
    resultJson: result,
    rawEvidenceIds: [],
    observationIds: [],
    lastError: null,
    createdAt: completedAt,
    updatedAt: completedAt,
    startedAt: null,
    completedAt
  };
  const runtimeDeps: DeepForensicJobRunnerDeps = {
    tronClient,
    claimNextForensicCheckJob: async () => null,
    completeForensicCheckJob: async () => false,
    recordRiskEvaluation: async () => undefined,
    updateForensicCheckJobProgress: (input) => updateForensicCheckJobProgress(db, input),
    releaseForensicCheckJobToWaiting: (input) => releaseForensicCheckJobToWaiting(db, input),
    getLabelsForAddress: (address) => listAddressLabels(db, address),
    getAddressMetadata: (address) => getAddressMetadata(db, address, completedAt),
    getContractIntelligenceProfile: async (address) =>
      await getContractIntelligenceProfile(db, address, completedAt) ??
      tronClient.getContractIntelligenceProfile(address, { now: completedAt, requireComplete: true }),
    getUsdtRestrictionStatus: tronClient.getUsdtRestrictionStatus.bind(tronClient),
    getTransaction: (txHash) => tronClient.getTransaction(txHash),
    listTrc20ApprovalChanges: (input) => tronClient.listTrc20ApprovalChanges(input),
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
    queueAddressUsdtHistory: (input) => queueTronAddressUsdtIndexState(db, {
      ...input,
      targetTimestamp: input.targetTimestamp ?? null,
      requestKind: input.requestKind ?? "broad_targeted",
      windowStartTimestamp: input.windowStartTimestamp ?? null,
      windowEndTimestamp: input.windowEndTimestamp ?? null,
      relatedHopTxHash: input.relatedHopTxHash ?? null,
      candidateTxHash: input.candidateTxHash ?? null,
      requestedByJobId: input.requestedByJobId ?? null,
      priority: input.queuedReason === "where_is_money_hop" ? 250 : input.queuedReason === "where_candidate_window" ? 240 : 10,
      nextRunAt: new Date(),
      budgetPages: input.budgetPages ?? null,
      maxAttempts: input.maxAttempts ?? null,
      allowRunningRequeue: input.allowRunningRequeue === true
    }),
    upsertForensicJobWait: (input) => upsertForensicJobWait(db, input),
    markWaitingForensicJobsReadyAfterTargetedIndex: (input) => markWaitingForensicJobsReadyAfterTargetedIndex(db, input),
    crossChainDiscoveryProvider,
    crossChainContinuationProviders,
    evmEvidenceProvider
  };
  const execution = createLegacyWhereIsMoneyExecution(runtimeDeps, runtimeJob, runtimeOptions);
  const checkerDeps = recordWhereIsMoneyDependencies(execution.dependencies, record);
  const { onProgress: _onProgress, abortSignal: _abortSignal, ...runOptions } = execution.runInput;
  const frozenClockIso = completedAt.toISOString();
  const options = JSON.parse(JSON.stringify(runOptions)) as Record<string, unknown>;
  const rerun = await withFrozenClock(frozenClockIso, () => execution.run(checkerDeps));
  const expectedStableFacts = projectStableWhereFacts(savedReport);
  if (canonicalizeArtifactJson(expectedStableFacts) !== canonicalizeArtifactJson(projectStableWhereFacts(rerun))) {
    throw new Error("where_latency_replay_stable_fact_mismatch");
  }
  const unresolvedEconomicRoleInputs = rerun.originPaths.flatMap((path) => (path.sourceProvenance ?? [])
    .filter((item) => item.proofClass === "unresolved")
    .map((item) => ({ txHash: item.targetTxHash })));
  const routeHashes = collectRouteCriticalTransactionHashes(rerun, {
    unresolvedEconomicRoleInputs,
    legacyObservedTransactionHashes: [...observedTransactions]
  });
  const routeAddresses = collectRouteCriticalAddresses(rerun);
  if (routeHashes.length === 0) throw new Error("where_latency_replay_route_critical_hash_missing");
  const indexedRows = await listIndexedTronUsdtTransfersByHashes(db, routeHashes);
  if (indexedRows.length === 0 || routeHashes.some((txHash) => !indexedRows.some((row) => row.txHash === txHash))) {
    throw new Error("where_latency_replay_indexed_movement_missing");
  }
  const assertions = await listActiveAddressLabelAssertionsForRoute(db, { chain: "tron", addresses: routeAddresses, txHashes: routeHashes });
  const rawTransactions = [];
  for (const txHash of routeHashes) {
    if (!observedTransactions.has(txHash)) {
      const response = await tronClient.getTransaction(txHash);
      const identity = recordField(response).txID ?? recordField(response).hash ?? recordField(response).id;
      if (typeof identity !== "string" || identity.toLowerCase() !== txHash.toLowerCase()) {
        throw new Error("where_latency_replay_transaction_info_identity_mismatch");
      }
      tape.push({ method: "getTransaction", args: [txHash], response, origin: "supplemental_stage_b_fixture" });
    }
    const raw = await tronClient.getRawTransaction(txHash) as JsonRecord;
    if (typeof raw.txID !== "string" || raw.txID.toLowerCase() !== txHash.toLowerCase()) {
      throw new Error("where_latency_replay_raw_transaction_binding_mismatch");
    }
    rawTransactions.push({ txHash, response: raw });
  }
  const complete = buildWhereLatencyReplayV1({
    schema: "where-latency-replay-v1", version: 1, baselineGitCommit: LEGACY_WHERE_REPLAY_BASELINE_COMMIT,
    resolvedConfigHash: nonSecretConfigHash(config as unknown as Record<string, unknown>, options),
    resolvedConfig: nonSecretConfig(config as unknown as Record<string, unknown>), resolvedOptions: options,
    frozenClockIso,
    job: { sourceAddress: jobSource, windowStart: windowStart.toISOString(), windowEnd: windowEnd.toISOString(), options },
    routeCriticalTxHashes: routeHashes,
    routeCriticalAddresses: routeAddresses,
    dependencies: tape,
    indexedMovements: [{ txHashes: routeHashes, rows: indexedRows.map(indexedSnapshotRow) }],
    assertionQueries: [{ chain: "tron", addresses: routeAddresses, txHashes: routeHashes, rows: assertions as unknown as Record<string, unknown>[] }],
    rawTransactions, baselineRequestCounts, expectedStableFacts
  });
  await writeReplayExclusive(output, complete.canonicalJson);
} finally {
  await closeDb(db);
}
