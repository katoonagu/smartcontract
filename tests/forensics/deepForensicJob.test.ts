import { describe, expect, it, vi } from "vitest";
import {
  normalizePersistedDeepFirstHopEvidence,
  type DeepAddressForensicReport
} from "../../src/check/deepForensicCheck";
import type { CrossChainTransfer } from "../../src/forensics/crossChainProviders";
import { runSingleDeepForensicJobCycle, type DeepForensicJobRunnerDeps } from "../../src/forensics/deepForensicJob";
import { TRON_USDT_CONTRACT_ADDRESS, type RawTronscanTrc20Transfer } from "../../src/parser/transactionParser";
import { deepForensicRuntimeOptions } from "../../src/runtime/deepForensicRuntimeOptions";
import { SCORING_SIGNAL_MATRIX_POLICY_VERSION } from "../../src/risk/scoringSignalMatrix";
import type { AddressLabelAssertionInput, ForensicCheckJob } from "../../src/storage/repositories";
import type { CrossChainEvidenceRef, ProviderPayloadRef, AddressLabel, ForensicRouteEdge, IndexedTronUsdtTransfer, StablecoinRestrictionProfile, TronAddressUsdtIndexState, WhereIsMoneyReport } from "../../src/types";
import type { TronscanApprovalChange } from "../../src/tron/tronClient";

const subject = "TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD";
const transit = "TTransit111111111111111111111111111111";
const seed = "TYFkLfEzv5eYgAxANwdGd26KyQwRZYiqtV";
const hintOne = "T111111111111111111111111111111111";
const hintTwo = "T222222222222222222222222222222222";
const hintThree = "T333333333333333333333333333333333";
const victim = "TVictim111111111111111111111111111111";
const spender = "TSpender11111111111111111111111111111";

type DeepForensicCompletionInput = Parameters<DeepForensicJobRunnerDeps["completeForensicCheckJob"]>[0];

function transfer(input: {
  id: string;
  from: string;
  to: string;
  amountRaw: string;
  at: string;
  triggerInfo?: unknown;
}): RawTronscanTrc20Transfer {
  return {
    transaction_id: input.id,
    from_address: input.from,
    to_address: input.to,
    quant: input.amountRaw,
    contract_address: TRON_USDT_CONTRACT_ADDRESS,
    confirmed: true,
    contractRet: "SUCCESS",
    block_ts: Date.parse(input.at),
    trigger_info: input.triggerInfo
  };
}

function job(): ForensicCheckJob {
  return {
    id: "job-1",
    kind: "address_deep_check",
    subjectAddress: subject,
    status: "running",
    windowStart: new Date("2026-05-01T00:00:00.000Z"),
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
    completedAt: null
  };
}

function queuedIndexState(address: string): TronAddressUsdtIndexState {
  const now = new Date("2026-07-02T00:00:00.000Z");
  return {
    address,
    tokenContract: TRON_USDT_CONTRACT_ADDRESS,
    coverageMode: "all_time",
    coverageKind: "provider_windowed",
    targetTimestamp: null,
    status: "queued",
    statusReason: null,
    provider: null,
    totalReported: null,
    fetchedTransferCount: 0,
    uniqueCounterpartyCount: 0,
    newestTransferAt: null,
    oldestTransferAt: null,
    coveredUntilTimestamp: null,
    fetchedPageCount: 0,
    plannedPageCount: null,
    currentEndTimestamp: null,
    providerCapHit: false,
    budgetExhausted: false,
    providerInconsistent: false,
    priority: 0,
    nextRunAt: now,
    attemptCount: 0,
    maxAttempts: 5,
    retryCount: 0,
    lastError: null,
    lastErrorClass: null,
    lastSuccessfulPageAt: null,
    queuedReason: "deep_subject",
    requestedByJobId: "job-1",
    lockedAt: null,
    lockedUntil: null,
    heartbeatAt: null,
    lockOwner: null,
    budgetPages: null,
    budgetSeconds: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now
  };
}

function darknetExchangeLabel(address: string): AddressLabel {
  return {
    address,
    label: "darknet_exchange",
    source: "service_admin",
    createdByTelegramId: "9001",
    createdAt: new Date("2026-05-01T00:00:00.000Z")
  };
}

function darknetExchangeProximityLabel(address: string): AddressLabel {
  return {
    address,
    label: "darknet_exchange_proximity",
    source: "system",
    createdByTelegramId: null,
    createdAt: new Date("2026-05-01T00:00:00.000Z")
  };
}

function usdtRestrictionProfile(overrides: Partial<StablecoinRestrictionProfile> = {}): StablecoinRestrictionProfile {
  return {
    subjectAddress: subject,
    tokenContract: TRON_USDT_CONTRACT_ADDRESS,
    tokenSymbol: "USDT",
    tokenStandard: "TRC20",
    decimals: 6,
    isBlacklisted: false,
    balanceRaw: null,
    checkedAt: "2026-05-24T00:00:00.000Z",
    evidenceStrength: "exact_contract_state",
    blacklistEventTxHash: null,
    blacklistEventTimestamp: null,
    blacklistEventBlock: null,
    methods: {
      blacklist: "isBlackListed(address)",
      balance: "balanceOf(address)"
    },
    ...overrides
  };
}

function approval(overrides: Partial<TronscanApprovalChange> = {}): TronscanApprovalChange {
  return {
    txHash: "tx-approval",
    ownerAddress: victim,
    spenderAddress: spender,
    tokenContract: TRON_USDT_CONTRACT_ADDRESS,
    amountRaw: "400000000000",
    isUnlimited: false,
    timestamp: new Date("2026-05-20T09:50:00.000Z"),
    confirmed: true,
    contractRet: "SUCCESS",
    ...overrides
  };
}

function indexedTransfer(overrides: Partial<IndexedTronUsdtTransfer>): IndexedTronUsdtTransfer {
  return {
    txHash: "indexed-transfer",
    blockNumber: 1,
    blockTimestamp: new Date("2026-05-10T00:00:00.000Z"),
    eventIndex: 0,
    fromAddress: transit,
    toAddress: subject,
    amountRaw: "1000000",
    method: "transfer",
    callerAddress: null,
    contractRet: "SUCCESS",
    confirmed: true,
    ...overrides
  };
}

async function runCompleteTargetedWhereMaterializationScenario(input: {
  hopRows: IndexedTronUsdtTransfer[];
  pageSize: number;
  maxRows?: number;
  throwOnTargetedHopRead?: boolean;
}) {
  const hopAddress = "THopLocalMaterialization11111111111111";
  const hopTimestamp = new Date("2026-05-20T12:00:00.000Z");
  const sourceJob: ForensicCheckJob = {
    ...job(),
    kind: "where_is_money_check",
    progressJson: { mode: "wallet_profile", requestedAmountRaw: "100000000" }
  };
  const targetTransfer = indexedTransfer({
    txHash: "tx-local-materialization-target",
    blockTimestamp: hopTimestamp,
    fromAddress: hopAddress,
    toAddress: subject,
    amountRaw: "100000000"
  });
  const subjectRows = [
    targetTransfer,
    ...Array.from({ length: Math.max(0, input.pageSize - 1) }, (_, index) => indexedTransfer({
      txHash: `tx-local-subject-noise-${index}`,
      eventIndex: index + 1,
      blockTimestamp: new Date(hopTimestamp.getTime() - (index + 1) * 1_000),
      fromAddress: subject,
      toAddress: transit,
      amountRaw: "1"
    }))
  ];
  const targetedOffsets: number[] = [];
  const targetedDirections: Array<"both" | undefined> = [];
  let completion: DeepForensicCompletionInput | undefined;
  const completeForensicCheckJob = vi.fn(async (input: DeepForensicCompletionInput) => {
    completion = input;
    return true;
  });
  const updateForensicCheckJobProgress = vi.fn(async () => true);
  const queueAddressUsdtHistory = vi.fn(async () => {
    throw new Error("complete targeted history must not requeue");
  });
  const releaseForensicCheckJobToWaiting = vi.fn(async () => true);
  const liveProvider = vi.fn(async (_address: string, _options?: { endTimestamp?: number }) => {
    throw new Error("fixture live provider unavailable");
  });
  const getAddressUsdtIndexState = vi.fn(async (stateInput: { address: string; targetTimestamp?: Date | null }) => ({
    ...queuedIndexState(stateInput.address),
    coverageMode: "targeted",
    requestKind: "broad_targeted",
    status: "complete",
    statusReason: "complete_provider_windowed",
    targetTimestamp: stateInput.targetTimestamp ?? null
  } as TronAddressUsdtIndexState));
  const listIndexedUsdtTransfersForAddress = vi.fn(async (address: string, options: {
    minTimestamp: Date;
    maxTimestamp: Date;
    limit: number;
    offset?: number;
    direction?: "both";
  }) => {
    if (address === subject) {
      const offset = options.offset ?? 0;
      return subjectRows.slice(offset, offset + options.limit);
    }
    if (address !== hopAddress) return [];
    if (options.maxTimestamp.getTime() === hopTimestamp.getTime() && options.offset !== undefined) {
      targetedOffsets.push(options.offset);
      targetedDirections.push(options.direction);
      if (input.throwOnTargetedHopRead) throw new Error("local index unavailable");
    }
    const offset = options.offset ?? 0;
    return input.hopRows.slice(offset, offset + options.limit);
  });

  const handled = await runSingleDeepForensicJobCycle({
    claimNextForensicCheckJob: async () => sourceJob,
    completeForensicCheckJob,
    updateForensicCheckJobProgress,
    releaseForensicCheckJobToWaiting,
    recordRiskEvaluation: vi.fn(async () => undefined),
    getAddressUsdtIndexState,
    getCoveringAddressUsdtIndexState: vi.fn(async () => null),
    queueAddressUsdtHistory,
    upsertForensicJobWait: vi.fn(async () => undefined),
    listIndexedUsdtTransfersForAddress,
    tronClient: { listRelatedTrc20Transfers: liveProvider },
    getLabelsForAddress: async () => [],
    getAddressMetadata: async (address) => address === seed
      ? {
          address,
          source: "tronscan",
          name: "Binance",
          tag: "Binance",
          isContract: false,
          verified: true,
          accountType: null,
          rawJson: {},
          fetchedAt: new Date("2026-05-20T12:00:00.000Z"),
          expiresAt: new Date("2026-05-21T12:00:00.000Z")
        }
      : null,
    getContractIntelligenceProfile: async () => null,
    getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({
      subjectAddress: address,
      balanceRaw: address === subject ? "100000000" : null
    })
  }, {
    maxEdgesPerAddress: 1,
    recentFallbackTransferLimit: input.pageSize,
    localIndexMaterializationMaxRows: input.maxRows
  });

  return {
    handled,
    hopAddress,
    hopTimestamp,
    targetedOffsets,
    targetedDirections,
    getAddressUsdtIndexState,
    listIndexedUsdtTransfersForAddress,
    liveProvider,
    queueAddressUsdtHistory,
    releaseForensicCheckJobToWaiting,
    updateForensicCheckJobProgress,
    completion
  };
}

function emptyDeepReport(): DeepAddressForensicReport {
  return {
    subjectAddress: subject,
    windowStart: new Date("2026-05-01T00:00:00.000Z"),
    windowEnd: new Date("2026-05-24T00:00:00.000Z"),
    runProfile: "production_full",
    providerBudget: {
      providerCallBudget: null,
      transferCallBudget: null,
      contractCallBudget: null,
      approvalCallBudget: null,
      elapsedTimeBudgetMs: null,
      exhausted: false
    },
    rawEvidence: [],
    observations: [],
    missingChecks: [],
    serviceExposureProfiles: [],
    addressBehaviorProfiles: [],
    inboundProvenanceProfiles: [],
    counterpartyRiskProfiles: [],
    directCounterpartyInteractionProfiles: [],
    approvalDrainProvenanceProfiles: [],
    assetContinuationProfiles: [],
    boundaryExposureProfiles: [],
    operationalFlowProfiles: [],
    walletRoleProfiles: [],
    extendedProvenanceProfiles: [],
    coverage: {
      sourceTransferPages: 0,
      inboundSendersExpanded: 0,
      transferEdges: 0
    },
    coverageDebug: {
      jobId: null,
      subjectAddress: subject,
      status: null,
      windowStart: "2026-05-01T00:00:00.000Z",
      windowEnd: "2026-05-24T00:00:00.000Z",
      summary: {
        sourceTransferPages: 0,
        transferEdges: 0,
        inboundSendersExpanded: 0,
        extendedIndexedEdges: 0,
        extendedFetchedAddresses: 0,
        apiKeyConfigured: null,
        thirtyDayTransferCount: 0,
        historicalFallbackTransferCount: 0,
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
    }
  };
}

describe("deep forensic job runner", () => {
  it("materializes row 151 from a complete targeted index before marking Where exact", async () => {
    const hopAddress = "THopLocalMaterialization11111111111111";
    const hopTimestamp = new Date("2026-05-20T12:00:00.000Z");
    const noiseRows = Array.from({ length: 150 }, (_, index) => indexedTransfer({
      txHash: index < 2 ? "tx-local-duplicate-noise" : `tx-local-noise-${index}`,
      eventIndex: index < 2 ? 0 : index,
      blockTimestamp: new Date(hopTimestamp.getTime() - (index + 1) * 1_000),
      fromAddress: hopAddress,
      toAddress: transit,
      amountRaw: "1"
    }));
    const materialSource = indexedTransfer({
      txHash: "tx-local-material-source",
      eventIndex: 151,
      blockTimestamp: new Date(hopTimestamp.getTime() - 200_000),
      fromAddress: seed,
      toAddress: hopAddress,
      amountRaw: "100000000"
    });

    const result = await runCompleteTargetedWhereMaterializationScenario({
      hopRows: [...noiseRows, materialSource],
      pageSize: 150
    });

    expect(result.handled).toBe(true);
    expect(result.getAddressUsdtIndexState).toHaveBeenCalledWith(expect.objectContaining({
      address: result.hopAddress,
      requestKind: "broad_targeted"
    }));
    expect(result.targetedOffsets).toEqual([0, 150]);
    expect(result.targetedDirections).toEqual(["both", "both"]);
    expect(result.liveProvider).not.toHaveBeenCalled();
    expect(result.queueAddressUsdtHistory).not.toHaveBeenCalled();
    expect(result.releaseForensicCheckJobToWaiting).not.toHaveBeenCalled();
    expect(result.updateForensicCheckJobProgress).toHaveBeenCalledWith(expect.objectContaining({
      progressJson: expect.objectContaining({
        jobPhase: "reading_local_index",
        targetedIndex: expect.objectContaining({
          phase: "reading_local_index",
          address: result.hopAddress,
          rowCount: 150,
          pageReadCount: 1
        })
      })
    }));
    expect(result.completion).toBeDefined();
    expect(result.completion!.resultJson).toMatchObject({ score_valid: false });
    const report = (result.completion!.resultJson as { whereIsMoneyReport: WhereIsMoneyReport }).whereIsMoneyReport;
    expect(report.originPaths.some((path) => path.pathAddresses.includes(seed))).toBe(true);
    expect(report.originPaths.flatMap((path) => path.historyCoverage ?? [])).toEqual(expect.arrayContaining([
      expect.objectContaining({
        address: result.hopAddress,
        fetchedTransferCount: 151,
        reachedTargetHop: true,
        coverageComplete: true,
        source: "local_index",
        providerCapHit: false,
        budgetExhausted: false,
        providerInconsistent: false,
        statusReason: null,
        localMaterializationStatus: "complete",
        localMaterializationCompletionReason: "proof_satisfied",
        localMaterializationKnownZero: false,
        localMaterializationError: null
      })
    ]));
  });

  it("marks a complete-index local ceiling as budget-limited, not provider-capped", async () => {
    const hopTimestamp = new Date("2026-05-20T12:00:00.000Z");
    const hopAddress = "THopLocalMaterialization11111111111111";
    const result = await runCompleteTargetedWhereMaterializationScenario({
      hopRows: Array.from({ length: 3 }, (_, index) => indexedTransfer({
        txHash: `tx-local-limit-${index}`,
        eventIndex: index,
        blockTimestamp: new Date(hopTimestamp.getTime() - (index + 1) * 1_000),
        fromAddress: hopAddress,
        toAddress: transit,
        amountRaw: "1"
      })),
      pageSize: 2,
      maxRows: 2
    });

    expect(result.targetedOffsets).toEqual([0, 2]);
    expect(result.liveProvider).not.toHaveBeenCalled();
    expect(result.completion).toBeDefined();
    const report = (result.completion!.resultJson as { whereIsMoneyReport: WhereIsMoneyReport }).whereIsMoneyReport;
    expect(report.originPaths.flatMap((path) => path.historyCoverage ?? [])).toEqual(expect.arrayContaining([
      expect.objectContaining({
        reachedTargetHop: false,
        coverageComplete: false,
        source: "local_index",
        providerCapHit: false,
        budgetExhausted: true,
        providerInconsistent: false,
        statusReason: null,
        localMaterializationStatus: "local_limit",
        localMaterializationCompletionReason: null,
        localMaterializationKnownZero: false,
        localMaterializationError: null
      })
    ]));
    expect(report).toMatchObject({
      scoreValid: false,
      scoreBlockedReason: "local_budget_limited",
      technicalStatus: "local_budget_limited",
      userDecision: "NO_FINAL_DECISION"
    });
    expect(result.completion!.resultJson).toMatchObject({
      score_valid: false,
      score_blocked_reason: "local_budget_limited",
      technical_status: "local_budget_limited"
    });
  });

  it("preserves complete known-zero local history as semantic unknown provenance", async () => {
    const result = await runCompleteTargetedWhereMaterializationScenario({
      hopRows: [],
      pageSize: 2
    });

    expect(result.targetedOffsets).toEqual([0]);
    expect(result.liveProvider).toHaveBeenCalledTimes(2);
    expect(result.liveProvider.mock.calls.some(([, options]) =>
      options?.endTimestamp === result.hopTimestamp.getTime()
    )).toBe(false);
    expect(result.completion).toBeDefined();
    const report = (result.completion!.resultJson as { whereIsMoneyReport: WhereIsMoneyReport }).whereIsMoneyReport;
    const path = report.originPaths[0];
    expect(["no_incoming_transfers_seen", "pre_existing_balance_possible"]).toContain(path?.stoppedReason);
    expect(path?.stoppedReason).not.toBe("incoming_history_not_fetched");
    expect(path?.historyCoverage).toEqual(expect.arrayContaining([
      expect.objectContaining({
        reachedTargetHop: true,
        coverageComplete: true,
        source: "local_index",
        providerCapHit: false,
        budgetExhausted: false,
        providerInconsistent: false,
        statusReason: null,
        localMaterializationStatus: "complete",
        localMaterializationCompletionReason: "window_exhausted",
        localMaterializationKnownZero: true,
        localMaterializationError: null
      })
    ]));
  });

  it("maps a complete-index local read failure to local data error without same-window fallback", async () => {
    const result = await runCompleteTargetedWhereMaterializationScenario({
      hopRows: [],
      pageSize: 2,
      throwOnTargetedHopRead: true
    });

    expect(result.targetedOffsets).toEqual([0]);
    expect(result.liveProvider).toHaveBeenCalledTimes(2);
    expect(result.liveProvider.mock.calls.some(([, options]) =>
      options?.endTimestamp === result.hopTimestamp.getTime()
    )).toBe(false);
    expect(result.queueAddressUsdtHistory).not.toHaveBeenCalled();
    expect(result.releaseForensicCheckJobToWaiting).not.toHaveBeenCalled();
    expect(result.completion).toBeDefined();
    const report = (result.completion!.resultJson as { whereIsMoneyReport: WhereIsMoneyReport }).whereIsMoneyReport;
    expect(report.originPaths.flatMap((path) => path.historyCoverage ?? [])).toEqual(expect.arrayContaining([
      expect.objectContaining({
        reachedTargetHop: false,
        coverageComplete: false,
        source: "local_index",
        providerCapHit: false,
        budgetExhausted: false,
        providerInconsistent: false,
        statusReason: null,
        localMaterializationStatus: "read_failed",
        localMaterializationCompletionReason: null,
        localMaterializationKnownZero: false,
        localMaterializationError: "local index unavailable"
      })
    ]));
    expect(report).toMatchObject({
      scoreValid: false,
      scoreBlockedReason: "local_index_read_failed",
      technicalStatus: "local_data_error",
      userDecision: "NO_FINAL_DECISION"
    });
    expect(result.completion!.resultJson).toMatchObject({
      score_valid: false,
      score_blocked_reason: "local_index_read_failed",
      technical_status: "local_data_error"
    });
  });

  it("persists provider error when runner edge acquisition fails before balance selection", async () => {
    const sourceJob: ForensicCheckJob = {
      ...job(),
      kind: "where_is_money_check",
      progressJson: { mode: "wallet_profile", requestedAmountRaw: "100000000" }
    };
    let completion: DeepForensicCompletionInput | undefined;

    const handled = await runSingleDeepForensicJobCycle({
      claimNextForensicCheckJob: async () => sourceJob,
      completeForensicCheckJob: async (input) => {
        completion = input;
        return true;
      },
      recordRiskEvaluation: async () => undefined,
      listIndexedUsdtTransfersForAddress: async () => {
        throw new Error("local index read unavailable");
      },
      tronClient: {
        listRelatedTrc20Transfers: async () => {
          throw new Error("503 provider temporarily unavailable");
        }
      },
      getLabelsForAddress: async () => [],
      getAddressMetadata: async () => null,
      getContractIntelligenceProfile: async () => null,
      getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({
        subjectAddress: address,
        balanceRaw: address === subject ? "100000000" : null
      })
    }, {
      maxEdgesPerAddress: 1,
      recentFallbackTransferLimit: 2
    });

    expect(handled).toBe(true);
    expect(completion).toBeDefined();
    const report = (completion!.resultJson as { whereIsMoneyReport: WhereIsMoneyReport }).whereIsMoneyReport;
    expect(report).toMatchObject({
      decision: "REVIEW",
      scoreValid: false,
      scoreBlockedReason: "provider_error",
      technicalStatus: "provider_error",
      userDecision: "NO_FINAL_DECISION"
    });
    expect(completion!.resultJson).toMatchObject({
      score_valid: false,
      score_blocked_reason: "provider_error",
      technical_status: "provider_error"
    });
    expect(report.assessment.warnings.join(" ")).toContain("technical");
  });

  it("waits for all-time subject indexing before strict Admin DeepCheck", async () => {
    vi.resetModules();
    const calls: string[] = [];
    const runDeepAddressForensicCheck = vi.fn(async () => {
      calls.push("deep");
      return emptyDeepReport();
    });
    vi.doMock("../../src/check/deepForensicCheck", async (importOriginal) => ({
      ...await importOriginal<typeof import("../../src/check/deepForensicCheck")>(),
      runDeepAddressForensicCheck
    }));

    try {
      const { runSingleDeepForensicJobCycle: runCycleWithMock } = await import("../../src/forensics/deepForensicJob");

      const handled = await runCycleWithMock({
        claimNextForensicCheckJob: async () => job(),
        completeForensicCheckJob: vi.fn(async () => true),
        recordRiskEvaluation: vi.fn(async () => undefined),
        tronClient: { listRelatedTrc20Transfers: async () => [] },
        getLabelsForAddress: async () => [],
        getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({ subjectAddress: address }),
        ensureAddressUsdtHistory: async (input) => {
          calls.push(`index:${input.address}:${input.coverageMode}`);
          return {
            ...queuedIndexState(input.address),
            status: "complete",
            statusReason: "complete_provider_windowed",
            provider: "tronscan",
            fetchedTransferCount: 4,
            uniqueCounterpartyCount: 2,
            newestTransferAt: new Date("2026-07-01T00:00:00.000Z"),
            oldestTransferAt: new Date("2026-01-01T00:00:00.000Z"),
            coveredUntilTimestamp: new Date("2026-01-01T00:00:00.000Z"),
            fetchedPageCount: 1,
            priority: 100,
            attemptCount: 1,
            lastSuccessfulPageAt: new Date("2026-07-02T00:00:00.000Z"),
            completedAt: new Date("2026-07-02T00:00:00.000Z")
          };
        }
      }, {
        pageLimit: 50,
        allTimeDeepCheckMode: "strict",
        secondLayerMaxActiveWalletsPerJob: 25,
        directHardEvidenceLiveLimit: 250,
        directHardEvidenceConcurrency: 8
      });

      expect(handled).toBe(true);
      expect(calls).toEqual([`index:${subject}:all_time`, "deep"]);
      expect(runDeepAddressForensicCheck).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
        allTimeMode: "strict",
        allTimeSubjectIndexState: expect.objectContaining({ status: "complete" }),
        secondLayerMaxActiveWalletsPerJob: 25,
        directHardEvidenceLiveLimit: 250,
        directHardEvidenceConcurrency: 8
      }));
    } finally {
      vi.doUnmock("../../src/check/deepForensicCheck");
      vi.resetModules();
    }
  });

  it("uses all-time strict mode and second-layer budget from job progress", async () => {
    vi.resetModules();
    const calls: string[] = [];
    const runDeepAddressForensicCheck = vi.fn(async () => {
      calls.push("deep");
      return emptyDeepReport();
    });
    vi.doMock("../../src/check/deepForensicCheck", async (importOriginal) => ({
      ...await importOriginal<typeof import("../../src/check/deepForensicCheck")>(),
      runDeepAddressForensicCheck
    }));

    try {
      const { runSingleDeepForensicJobCycle: runCycleWithMock } = await import("../../src/forensics/deepForensicJob");
      const strictJob = {
        ...job(),
        progressJson: {
          ...job().progressJson,
          allTimeDeepCheckMode: "strict",
          secondLayerMaxActiveWalletsPerJob: 25
        }
      };

      const handled = await runCycleWithMock({
        claimNextForensicCheckJob: async () => strictJob,
        completeForensicCheckJob: vi.fn(async () => true),
        recordRiskEvaluation: vi.fn(async () => undefined),
        tronClient: { listRelatedTrc20Transfers: async () => [] },
        getLabelsForAddress: async () => [],
        getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({ subjectAddress: address }),
        ensureAddressUsdtHistory: async (input) => {
          calls.push(`index:${input.address}:${input.coverageMode}`);
          return {
            ...queuedIndexState(input.address),
            status: "complete",
            statusReason: "complete_provider_windowed"
          };
        }
      }, {
        pageLimit: 50,
        allTimeDeepCheckMode: "partial",
        secondLayerMaxActiveWalletsPerJob: 0
      });

      expect(handled).toBe(true);
      expect(calls).toEqual([`index:${subject}:all_time`, "deep"]);
      expect(runDeepAddressForensicCheck).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
        allTimeMode: "strict",
        secondLayerMaxActiveWalletsPerJob: 25,
        allTimeSubjectIndexState: expect.objectContaining({ status: "complete" })
      }));
    } finally {
      vi.doUnmock("../../src/check/deepForensicCheck");
      vi.resetModules();
    }
  });

  it("queues all-time subject indexing but does not wait in partial bot mode", async () => {
    vi.resetModules();
    const calls: string[] = [];
    const runDeepAddressForensicCheck = vi.fn(async () => {
      calls.push("deep");
      return emptyDeepReport();
    });
    vi.doMock("../../src/check/deepForensicCheck", async (importOriginal) => ({
      ...await importOriginal<typeof import("../../src/check/deepForensicCheck")>(),
      runDeepAddressForensicCheck
    }));

    try {
      const { runSingleDeepForensicJobCycle: runCycleWithMock } = await import("../../src/forensics/deepForensicJob");

      const handled = await runCycleWithMock({
        claimNextForensicCheckJob: async () => job(),
        completeForensicCheckJob: vi.fn(async () => true),
        recordRiskEvaluation: vi.fn(async () => undefined),
        tronClient: { listRelatedTrc20Transfers: async () => [] },
        getLabelsForAddress: async () => [],
        getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({ subjectAddress: address }),
        ensureAddressUsdtHistory: async () => {
          throw new Error("partial mode must not block on all-time indexing");
        },
        queueAddressUsdtHistory: async (input) => {
          calls.push(`queue:${input.address}:${input.coverageMode}`);
          return queuedIndexState(input.address);
        }
      }, {
        pageLimit: 50,
        allTimeDeepCheckMode: "partial"
      });

      expect(handled).toBe(true);
      expect(calls).toEqual([`queue:${subject}:all_time`, "deep"]);
      expect(runDeepAddressForensicCheck).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
        allTimeMode: "partial",
        allTimeSubjectIndexState: null
      }));
    } finally {
      vi.doUnmock("../../src/check/deepForensicCheck");
      vi.resetModules();
    }
  });

  it("queues missing second-layer direct wallets from strict DeepCheck results", async () => {
    const walletA = "TSecondLayerQueueWalletA1111111111";
    const sourceJob = job();
    const subjectIndexState = {
      ...queuedIndexState(subject),
      status: "complete" as const,
      statusReason: "complete_provider_windowed" as const,
      provider: "tronscan" as const,
      fetchedTransferCount: 1,
      uniqueCounterpartyCount: 1,
      newestTransferAt: new Date("2026-06-01T00:00:00.000Z"),
      oldestTransferAt: new Date("2026-06-01T00:00:00.000Z"),
      coveredUntilTimestamp: new Date("2026-06-01T00:00:00.000Z"),
      fetchedPageCount: 1,
      completedAt: new Date("2026-07-02T00:00:00.000Z")
    };
    const subjectTransfers = [indexedTransfer({
      txHash: "tx-subject-wallet-a",
      fromAddress: subject,
      toAddress: walletA,
      amountRaw: "100000000",
      blockTimestamp: new Date("2026-06-01T00:00:00.000Z")
    })];
    const queueAddressUsdtHistory = vi.fn(async (input: Parameters<NonNullable<Parameters<typeof runSingleDeepForensicJobCycle>[0]["queueAddressUsdtHistory"]>>[0]) => ({
      ...queuedIndexState(input.address),
      coverageMode: input.coverageMode,
      targetTimestamp: input.targetTimestamp ?? null,
      queuedReason: input.queuedReason,
      requestedByJobId: input.requestedByJobId ?? null
    }));
    const completeForensicCheckJob = vi.fn(async (_input: Parameters<Parameters<typeof runSingleDeepForensicJobCycle>[0]["completeForensicCheckJob"]>[0]) => true);

    const handled = await runSingleDeepForensicJobCycle({
      claimNextForensicCheckJob: async () => sourceJob,
      completeForensicCheckJob,
      recordRiskEvaluation: vi.fn(async () => undefined),
      ensureAddressUsdtHistory: async () => subjectIndexState,
      queueAddressUsdtHistory,
      listIndexedUsdtTransfersForAddress: async (address, options) => {
        const transfers = address === subject ? subjectTransfers : [];
        return transfers.slice(options.offset ?? 0, (options.offset ?? 0) + options.limit);
      },
      getAddressUsdtIndexState: async (input) => input.address === walletA ? null : subjectIndexState,
      tronClient: { listRelatedTrc20Transfers: async () => [] },
      getLabelsForAddress: async () => [],
      getAddressMetadata: async () => null,
      getContractIntelligenceProfile: async () => null,
      getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({ subjectAddress: address })
    }, {
      pageLimit: 50,
      maxInboundSenders: 1,
      extendedSearchMode: "disabled",
      allTimeDeepCheckMode: "strict",
      secondLayerMaxActiveWalletsPerJob: 25
    });

    expect(handled).toBe(true);
    expect(queueAddressUsdtHistory).toHaveBeenCalledWith({
      address: walletA,
      coverageMode: "all_time",
      requestedByJobId: sourceJob.id,
      queuedReason: "deep_second_layer"
    });
    const completed = completeForensicCheckJob.mock.calls[0][0];
    expect(completed.resultJson.secondLayerRelationshipProfiles).toMatchObject({
      directWalletStatuses: [
        expect.objectContaining({
          address: walletA,
          status: "queued",
          queued: true
        })
      ]
    });
    expect(completed.progressJson.allTimeCoverage).toMatchObject({
      directWalletsQueuedForIndexing: 1,
      secondLayerQueued: 1,
      secondLayerComplete: 0
    });
  });

  it("continues strict DeepCheck when one second-layer queue request fails", async () => {
    const walletA = "TSecondLayerQueueWalletA1111111111";
    const walletB = "TSecondLayerQueueWalletB1111111111";
    const sourceJob = job();
    const subjectIndexState = {
      ...queuedIndexState(subject),
      status: "complete" as const,
      statusReason: "complete_provider_windowed" as const,
      provider: "tronscan" as const,
      fetchedTransferCount: 2,
      uniqueCounterpartyCount: 2,
      newestTransferAt: new Date("2026-06-02T00:00:00.000Z"),
      oldestTransferAt: new Date("2026-06-01T00:00:00.000Z"),
      coveredUntilTimestamp: new Date("2026-06-01T00:00:00.000Z"),
      fetchedPageCount: 1,
      completedAt: new Date("2026-07-02T00:00:00.000Z")
    };
    const subjectTransfers = [
      indexedTransfer({
        txHash: "tx-subject-wallet-a",
        fromAddress: subject,
        toAddress: walletA,
        amountRaw: "200000000",
        blockTimestamp: new Date("2026-06-01T00:00:00.000Z")
      }),
      indexedTransfer({
        txHash: "tx-subject-wallet-b",
        fromAddress: subject,
        toAddress: walletB,
        amountRaw: "100000000",
        blockTimestamp: new Date("2026-06-02T00:00:00.000Z"),
        eventIndex: 1
      })
    ];
    const queueAddressUsdtHistory = vi.fn(async (input: Parameters<NonNullable<Parameters<typeof runSingleDeepForensicJobCycle>[0]["queueAddressUsdtHistory"]>>[0]) => {
      if (input.address === walletB) throw new Error("queue failed");
      return {
        ...queuedIndexState(input.address),
        coverageMode: input.coverageMode,
        queuedReason: input.queuedReason,
        requestedByJobId: input.requestedByJobId ?? null
      };
    });
    const completeForensicCheckJob = vi.fn(async (_input: Parameters<Parameters<typeof runSingleDeepForensicJobCycle>[0]["completeForensicCheckJob"]>[0]) => true);

    const handled = await runSingleDeepForensicJobCycle({
      claimNextForensicCheckJob: async () => sourceJob,
      completeForensicCheckJob,
      recordRiskEvaluation: vi.fn(async () => undefined),
      ensureAddressUsdtHistory: async () => subjectIndexState,
      queueAddressUsdtHistory,
      listIndexedUsdtTransfersForAddress: async (address, options) => {
        const transfers = address === subject ? subjectTransfers : [];
        return transfers.slice(options.offset ?? 0, (options.offset ?? 0) + options.limit);
      },
      getAddressUsdtIndexState: async () => null,
      tronClient: { listRelatedTrc20Transfers: async () => [] },
      getLabelsForAddress: async () => [],
      getAddressMetadata: async () => null,
      getContractIntelligenceProfile: async () => null,
      getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({ subjectAddress: address })
    }, {
      pageLimit: 50,
      maxInboundSenders: 1,
      extendedSearchMode: "disabled",
      allTimeDeepCheckMode: "strict",
      secondLayerMaxActiveWalletsPerJob: 25
    });

    expect(handled).toBe(true);
    expect(queueAddressUsdtHistory).toHaveBeenCalledTimes(2);
    const completed = completeForensicCheckJob.mock.calls[0][0];
    expect(completed.status).toBe("completed");
    expect(completed.resultJson.secondLayerRelationshipProfiles).toMatchObject({
      directWalletStatuses: [
        expect.objectContaining({ address: walletA, status: "queued", queued: true }),
        expect.objectContaining({ address: walletB, status: "not_indexed", queued: false })
      ]
    });
    expect(completed.progressJson.allTimeCoverage).toMatchObject({
      directWalletsQueuedForIndexing: 1,
      secondLayerQueued: 1,
      secondLayerComplete: 0
    });
  });

  it("does not mark second-layer wallets queued when queue returns complete state", async () => {
    const walletA = "TSecondLayerQueueWalletA1111111111";
    const sourceJob = job();
    const subjectIndexState = {
      ...queuedIndexState(subject),
      status: "complete" as const,
      statusReason: "complete_provider_windowed" as const,
      provider: "tronscan" as const,
      fetchedTransferCount: 1,
      uniqueCounterpartyCount: 1,
      newestTransferAt: new Date("2026-06-01T00:00:00.000Z"),
      oldestTransferAt: new Date("2026-06-01T00:00:00.000Z"),
      coveredUntilTimestamp: new Date("2026-06-01T00:00:00.000Z"),
      fetchedPageCount: 1,
      completedAt: new Date("2026-07-02T00:00:00.000Z")
    };
    const subjectTransfers = [indexedTransfer({
      txHash: "tx-subject-wallet-a",
      fromAddress: subject,
      toAddress: walletA,
      amountRaw: "100000000",
      blockTimestamp: new Date("2026-06-01T00:00:00.000Z")
    })];
    const queueAddressUsdtHistory = vi.fn(async (input: Parameters<NonNullable<Parameters<typeof runSingleDeepForensicJobCycle>[0]["queueAddressUsdtHistory"]>>[0]) => ({
      ...subjectIndexState,
      address: input.address,
      queuedReason: input.queuedReason,
      requestedByJobId: input.requestedByJobId ?? null
    }));
    const completeForensicCheckJob = vi.fn(async (_input: Parameters<Parameters<typeof runSingleDeepForensicJobCycle>[0]["completeForensicCheckJob"]>[0]) => true);

    const handled = await runSingleDeepForensicJobCycle({
      claimNextForensicCheckJob: async () => sourceJob,
      completeForensicCheckJob,
      recordRiskEvaluation: vi.fn(async () => undefined),
      ensureAddressUsdtHistory: async () => subjectIndexState,
      queueAddressUsdtHistory,
      listIndexedUsdtTransfersForAddress: async (address, options) => {
        const transfers = address === subject ? subjectTransfers : [];
        return transfers.slice(options.offset ?? 0, (options.offset ?? 0) + options.limit);
      },
      getAddressUsdtIndexState: async () => null,
      tronClient: { listRelatedTrc20Transfers: async () => [] },
      getLabelsForAddress: async () => [],
      getAddressMetadata: async () => null,
      getContractIntelligenceProfile: async () => null,
      getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({ subjectAddress: address })
    }, {
      pageLimit: 50,
      maxInboundSenders: 1,
      extendedSearchMode: "disabled",
      allTimeDeepCheckMode: "strict",
      secondLayerMaxActiveWalletsPerJob: 25
    });

    expect(handled).toBe(true);
    expect(queueAddressUsdtHistory).toHaveBeenCalledTimes(1);
    const completed = completeForensicCheckJob.mock.calls[0][0];
    expect(completed.status).toBe("completed");
    expect(completed.resultJson.secondLayerRelationshipProfiles).toMatchObject({
      directWalletStatuses: [
        expect.objectContaining({ address: walletA, status: "not_indexed", queued: false })
      ]
    });
    expect(completed.progressJson.allTimeCoverage).toMatchObject({
      directWalletsQueuedForIndexing: 0,
      secondLayerQueued: 0,
      secondLayerComplete: 0
    });
  });

  it("stores all-time progress only when the report includes all-time coverage", async () => {
    vi.resetModules();
    const allTime = {
      mode: "strict",
      subjectIndexStatus: "complete",
      subjectCoverageMode: "all_time",
      subjectAllTimeComplete: true,
      subjectStatusReason: "complete_provider_windowed",
      subjectCoveredUntilTimestamp: "1970-01-01T00:00:00.000Z",
      subjectTargetTimestamp: null,
      subjectTransfersFetched: 4,
      subjectUniqueDirectWallets: 2,
      directWalletsHardEvidenceChecked: 0,
      directWalletsHardEvidenceLiveChecked: 0,
      directHardEvidenceStatus: "complete",
      directWalletsQueuedForIndexing: 0,
      secondLayerActiveBudget: 0,
      secondLayerQueued: 0,
      secondLayerComplete: 0,
      providerEffectiveRps: null,
      providerRateLimitedRequests: 0,
      providerCapHit: false,
      providerInconsistent: false,
      suppressedServiceWallets: 0,
      suppressedHighDegreeWallets: 0
    };
    const report = {
      ...emptyDeepReport(),
      coverage: {
        ...emptyDeepReport().coverage,
        allTime
      }
    } as DeepAddressForensicReport;
    vi.doMock("../../src/check/deepForensicCheck", async (importOriginal) => ({
      ...await importOriginal<typeof import("../../src/check/deepForensicCheck")>(),
      runDeepAddressForensicCheck: async () => report
    }));

    try {
      const { runSingleDeepForensicJobCycle: runCycleWithMock } = await import("../../src/forensics/deepForensicJob");
      const completeForensicCheckJob = vi.fn(async (_input: Parameters<Parameters<typeof runSingleDeepForensicJobCycle>[0]["completeForensicCheckJob"]>[0]) => true);

      await runCycleWithMock({
        claimNextForensicCheckJob: async () => job(),
        completeForensicCheckJob,
        recordRiskEvaluation: vi.fn(async () => undefined),
        tronClient: { listRelatedTrc20Transfers: async () => [] },
        getLabelsForAddress: async () => [],
        getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({ subjectAddress: address })
      });

      expect(completeForensicCheckJob.mock.calls[0][0].progressJson).toMatchObject({
        allTimeCoverage: allTime
      });
    } finally {
      vi.doUnmock("../../src/check/deepForensicCheck");
      vi.resetModules();
    }
  });

  it("omits all-time progress when the report has no all-time coverage", async () => {
    vi.resetModules();
    vi.doMock("../../src/check/deepForensicCheck", async (importOriginal) => ({
      ...await importOriginal<typeof import("../../src/check/deepForensicCheck")>(),
      runDeepAddressForensicCheck: async () => emptyDeepReport()
    }));

    try {
      const { runSingleDeepForensicJobCycle: runCycleWithMock } = await import("../../src/forensics/deepForensicJob");
      const completeForensicCheckJob = vi.fn(async (_input: Parameters<Parameters<typeof runSingleDeepForensicJobCycle>[0]["completeForensicCheckJob"]>[0]) => true);

      await runCycleWithMock({
        claimNextForensicCheckJob: async () => job(),
        completeForensicCheckJob,
        recordRiskEvaluation: vi.fn(async () => undefined),
        tronClient: { listRelatedTrc20Transfers: async () => [] },
        getLabelsForAddress: async () => [],
        getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({ subjectAddress: address })
      });

      expect(completeForensicCheckJob.mock.calls[0][0].progressJson).not.toHaveProperty("allTimeCoverage");
    } finally {
      vi.doUnmock("../../src/check/deepForensicCheck");
      vi.resetModules();
    }
  });

  it("passes production Deep Research defaults into address jobs", async () => {
    vi.resetModules();
    const runDeepAddressForensicCheck = vi.fn(async () => emptyDeepReport());
    vi.doMock("../../src/check/deepForensicCheck", async (importOriginal) => ({
      ...await importOriginal<typeof import("../../src/check/deepForensicCheck")>(),
      runDeepAddressForensicCheck
    }));

    try {
      const { runSingleDeepForensicJobCycle: runCycleWithMock } = await import("../../src/forensics/deepForensicJob");

      const handled = await runCycleWithMock({
        claimNextForensicCheckJob: async () => job(),
        completeForensicCheckJob: vi.fn(async () => true),
        recordRiskEvaluation: vi.fn(async () => undefined),
        tronClient: {
          listRelatedTrc20Transfers: async () => []
        },
        getLabelsForAddress: async () => [],
        getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({ subjectAddress: address })
      });

      expect(handled).toBe(true);
      expect(runDeepAddressForensicCheck).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          maxDepth: 3,
          pageLimit: 100,
          maxPagesPerAddress: 3,
          maxExpandedIntermediates: 30,
          metadataFetchLimit: 30,
          contractProfileFetchLimit: 15,
          maxInboundSenders: 15,
          maxApprovalDrainCandidates: 15,
          approvalChangeLookupLimit: 20,
          extendedSearchMode: "always",
          extendedSearchMaxDepth: 6,
          extendedSearchBeamWidth: 12,
          extendedSearchMaxAddressFetches: 150,
          recentFallbackMinTransferCount: 150,
          recentFallbackTransferLimit: 150,
          counterpartyFastSnapshotLimit: 60,
          counterpartyFastSnapshotActiveLimit: 30
        })
      );
    } finally {
      vi.doUnmock("../../src/check/deepForensicCheck");
      vi.resetModules();
    }
  });

  it("passes valid fastCheckHints from progress_json into address deep checks", async () => {
    vi.resetModules();
    const runDeepAddressForensicCheck = vi.fn(async () => emptyDeepReport());
    vi.doMock("../../src/check/deepForensicCheck", async (importOriginal) => ({
      ...await importOriginal<typeof import("../../src/check/deepForensicCheck")>(),
      runDeepAddressForensicCheck
    }));

    try {
      const { runSingleDeepForensicJobCycle: runCycleWithMock } = await import("../../src/forensics/deepForensicJob");
      const sourceJob = job();
      sourceJob.progressJson = {
        fastRiskSnapshot: { score: 0, level: "LOW" },
        fastCheckHints: {
          fastCheckJobId: "fast-job-1",
          subjectAddress: sourceJob.subjectAddress,
          windowStart: sourceJob.windowStart.toISOString(),
          windowEnd: sourceJob.windowEnd.toISOString(),
          topIncomingAddresses: [{
            address: hintOne,
            direction: "incoming",
            volumeRaw: "3000",
            txCount: 3,
            category: "cex",
            identity: "Exchange One",
            reason: "top_fast_incoming_counterparty"
          }],
          topOutgoingAddresses: [
            {
              address: hintOne,
              direction: "outgoing",
              volumeRaw: "2000",
              txCount: 2,
              category: null,
              identity: null,
              reason: "duplicate_should_not_replace_first"
            },
            {
              address: hintTwo,
              direction: "outgoing",
              volumeRaw: "1000",
              txCount: 1,
              category: null,
              identity: null,
              reason: "top_fast_outgoing_counterparty"
            }
          ],
          topServiceAddresses: [{
            address: hintThree,
            direction: "service",
            volumeRaw: "900",
            txCount: 1,
            category: "router",
            identity: null,
            reason: "top_fast_service_counterparty"
          }]
        }
      };

      const handled = await runCycleWithMock({
        claimNextForensicCheckJob: async () => sourceJob,
        completeForensicCheckJob: vi.fn(async () => true),
        recordRiskEvaluation: vi.fn(async () => undefined),
        tronClient: {
          listRelatedTrc20Transfers: async () => []
        },
        getLabelsForAddress: async () => [],
        getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({ subjectAddress: address })
      });

      expect(handled).toBe(true);
      const deepInput = (runDeepAddressForensicCheck.mock.calls as unknown[][])[0]?.[1];
      expect(deepInput).toMatchObject({
        fastCheckHints: [
          {
            address: hintOne,
            direction: "incoming",
            volumeRaw: "3000",
            txCount: 3,
            category: "cex",
            identity: "Exchange One",
            reason: "top_fast_incoming_counterparty"
          },
          {
            address: hintTwo,
            direction: "outgoing",
            volumeRaw: "1000",
            txCount: 1,
            category: null,
            identity: null,
            reason: "top_fast_outgoing_counterparty"
          },
          {
            address: hintThree,
            direction: "service",
            volumeRaw: "900",
            txCount: 1,
            category: "router",
            identity: null,
            reason: "top_fast_service_counterparty"
          }
        ]
      });
    } finally {
      vi.doUnmock("../../src/check/deepForensicCheck");
      vi.resetModules();
    }
  });

  it("ignores malformed fastCheckHints rows before running address deep checks", async () => {
    vi.resetModules();
    const runDeepAddressForensicCheck = vi.fn(async () => emptyDeepReport());
    vi.doMock("../../src/check/deepForensicCheck", async (importOriginal) => ({
      ...await importOriginal<typeof import("../../src/check/deepForensicCheck")>(),
      runDeepAddressForensicCheck
    }));

    try {
      const { runSingleDeepForensicJobCycle: runCycleWithMock } = await import("../../src/forensics/deepForensicJob");
      const sourceJob = job();
      sourceJob.progressJson = {
        fastRiskSnapshot: { score: 0, level: "LOW" },
        fastCheckHints: {
          fastCheckJobId: "fast-job-1",
          subjectAddress: sourceJob.subjectAddress,
          windowStart: sourceJob.windowStart.toISOString(),
          windowEnd: sourceJob.windowEnd.toISOString(),
          topIncomingAddresses: [
            { address: "bad", direction: "incoming", volumeRaw: "1", txCount: 1, category: null, identity: null },
            { address: hintOne, direction: "incoming", volumeRaw: "1.5", txCount: 1, category: null, identity: null },
            { address: hintTwo, direction: "incoming", volumeRaw: "2", txCount: 0, category: null, identity: null },
            { address: hintThree, direction: "incoming", volumeRaw: "3", txCount: 1, category: "not_allowed", identity: null },
            { address: hintOne, direction: "incoming", volumeRaw: "4", txCount: 1, category: null, identity: "Valid Hint", reason: "valid_reason" }
          ],
          topOutgoingAddresses: [],
          topServiceAddresses: []
        }
      };

      const handled = await runCycleWithMock({
        claimNextForensicCheckJob: async () => sourceJob,
        completeForensicCheckJob: vi.fn(async () => true),
        recordRiskEvaluation: vi.fn(async () => undefined),
        tronClient: {
          listRelatedTrc20Transfers: async () => []
        },
        getLabelsForAddress: async () => [],
        getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({ subjectAddress: address })
      });

      expect(handled).toBe(true);
      const deepInput = (runDeepAddressForensicCheck.mock.calls as unknown[][])[0]?.[1];
      expect(deepInput).toMatchObject({
        fastCheckHints: [{
          address: hintOne,
          direction: "incoming",
          volumeRaw: "4",
          txCount: 1,
          category: null,
          identity: "Valid Hint",
          reason: "valid_reason"
        }]
      });
    } finally {
      vi.doUnmock("../../src/check/deepForensicCheck");
      vi.resetModules();
    }
  });

  it("ignores stale fastCheckHints when subject or window does not match", async () => {
    vi.resetModules();
    const runDeepAddressForensicCheck = vi.fn(async () => emptyDeepReport());
    vi.doMock("../../src/check/deepForensicCheck", async (importOriginal) => ({
      ...await importOriginal<typeof import("../../src/check/deepForensicCheck")>(),
      runDeepAddressForensicCheck
    }));

    try {
      const { runSingleDeepForensicJobCycle: runCycleWithMock } = await import("../../src/forensics/deepForensicJob");
      const sourceJob = job();
      sourceJob.progressJson = {
        fastRiskSnapshot: { score: 0, level: "LOW" },
        fastCheckHints: {
          fastCheckJobId: "fast-job-1",
          subjectAddress: "TWrong111111111111111111111111111111",
          windowStart: sourceJob.windowStart.toISOString(),
          windowEnd: sourceJob.windowEnd.toISOString(),
          topIncomingAddresses: [{
            address: hintOne,
            direction: "incoming",
            volumeRaw: "3000",
            txCount: 3,
            category: "cex",
            identity: "Exchange One",
            reason: "top_fast_incoming_counterparty"
          }],
          topOutgoingAddresses: [],
          topServiceAddresses: []
        }
      };

      const handled = await runCycleWithMock({
        claimNextForensicCheckJob: async () => sourceJob,
        completeForensicCheckJob: vi.fn(async () => true),
        recordRiskEvaluation: vi.fn(async () => undefined),
        tronClient: {
          listRelatedTrc20Transfers: async () => []
        },
        getLabelsForAddress: async () => [],
        getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({ subjectAddress: address })
      });

      expect(handled).toBe(true);
      const deepInput = (runDeepAddressForensicCheck.mock.calls as unknown[][])[0]?.[1];
      expect(deepInput).toMatchObject({
        fastCheckHints: []
      });
    } finally {
      vi.doUnmock("../../src/check/deepForensicCheck");
      vi.resetModules();
    }
  });

  it("persists Deep report scoring context into address job result JSON", async () => {
    vi.resetModules();
    const providerBudget: DeepAddressForensicReport["providerBudget"] = {
      providerCallBudget: 11,
      transferCallBudget: 7,
      contractCallBudget: 3,
      approvalCallBudget: 2,
      elapsedTimeBudgetMs: 1500,
      exhausted: true
    };
    const assetContinuationProfiles = [{
      subjectAddress: subject,
      continuationScore: 42,
      reason: "test asset continuation"
    }] as unknown as NonNullable<DeepAddressForensicReport["assetContinuationProfiles"]>;
    const boundaryExposureProfiles = [{
      subjectAddress: subject,
      contextScore: 43,
      reason: "test boundary exposure"
    }] as unknown as DeepAddressForensicReport["boundaryExposureProfiles"];
    const operationalFlowProfiles = [{
      subjectAddress: subject,
      operationalScore: 44,
      reason: "test operational flow"
    }] as unknown as NonNullable<DeepAddressForensicReport["operationalFlowProfiles"]>;
    const walletRoleProfiles = [{
      subjectAddress: subject,
      roleScore: 45,
      reason: "test wallet role"
    }] as unknown as DeepAddressForensicReport["walletRoleProfiles"];
    const report: DeepAddressForensicReport = {
      ...emptyDeepReport(),
      runProfile: "bounded_rerun",
      providerBudget,
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
      },
      assetContinuationProfiles,
      boundaryExposureProfiles,
      operationalFlowProfiles,
      walletRoleProfiles
    };
    const runDeepAddressForensicCheck = vi.fn(async () => report);
    vi.doMock("../../src/check/deepForensicCheck", async (importOriginal) => ({
      ...await importOriginal<typeof import("../../src/check/deepForensicCheck")>(),
      runDeepAddressForensicCheck
    }));

    try {
      const { runSingleDeepForensicJobCycle: runCycleWithMock } = await import("../../src/forensics/deepForensicJob");
      const completeForensicCheckJob = vi.fn(async (_input: Parameters<Parameters<typeof runSingleDeepForensicJobCycle>[0]["completeForensicCheckJob"]>[0]) => true);

      const handled = await runCycleWithMock({
        claimNextForensicCheckJob: async () => job(),
        completeForensicCheckJob,
        recordRiskEvaluation: vi.fn(async () => undefined),
        tronClient: {
          listRelatedTrc20Transfers: async () => []
        },
        getLabelsForAddress: async () => [],
        getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({ subjectAddress: address })
      });

      expect(handled).toBe(true);
      expect(completeForensicCheckJob.mock.calls[0][0].resultJson).toMatchObject({
        runProfile: "bounded_rerun",
        providerBudget,
        contractDrivenCampaignSummary: report.contractDrivenCampaignSummary,
        assetContinuationProfiles,
        boundaryExposureProfiles,
        operationalFlowProfiles,
        walletRoleProfiles
      });
    } finally {
      vi.doUnmock("../../src/check/deepForensicCheck");
      vi.resetModules();
    }
  });

  it("marks successful Deep jobs completed even when coverage warnings are present", async () => {
    vi.resetModules();
    const report: DeepAddressForensicReport = {
      ...emptyDeepReport(),
      missingChecks: ["Metadata enrichment limited to 30 of 631 candidate exposure addresses."]
    };
    const runDeepAddressForensicCheck = vi.fn(async () => report);
    vi.doMock("../../src/check/deepForensicCheck", async (importOriginal) => ({
      ...await importOriginal<typeof import("../../src/check/deepForensicCheck")>(),
      runDeepAddressForensicCheck
    }));

    try {
      const { runSingleDeepForensicJobCycle: runCycleWithMock } = await import("../../src/forensics/deepForensicJob");
      const completeForensicCheckJob = vi.fn(async (_input: Parameters<Parameters<typeof runSingleDeepForensicJobCycle>[0]["completeForensicCheckJob"]>[0]) => true);

      const handled = await runCycleWithMock({
        claimNextForensicCheckJob: async () => job(),
        completeForensicCheckJob,
        recordRiskEvaluation: vi.fn(async () => undefined),
        tronClient: {
          listRelatedTrc20Transfers: async () => []
        },
        getLabelsForAddress: async () => [],
        getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({ subjectAddress: address })
      });

      expect(handled).toBe(true);
      expect(completeForensicCheckJob).toHaveBeenCalledWith(expect.objectContaining({
        status: "completed",
        resultJson: expect.objectContaining({
          missingChecks: report.missingChecks
        })
      }));
    } finally {
      vi.doUnmock("../../src/check/deepForensicCheck");
      vi.resetModules();
    }
  });

  it("marks successful where-is-money jobs completed while preserving partial coverage notes", async () => {
    vi.resetModules();
    const whereReport = {
      subjectAddress: subject,
      decision: "REVIEW",
      riskScore: 42,
      coverage: {
        partial: true,
        notes: ["Fetched incoming transfer history did not reach the current hop timestamp; source remains unproven."]
      }
    } as unknown as WhereIsMoneyReport;
    const runWhereIsMoneyCheck = vi.fn(async (_deps: unknown, _input: unknown) => whereReport);
    vi.doMock("../../src/check/whereIsMoneyCheck", async (importOriginal) => ({
      ...await importOriginal<typeof import("../../src/check/whereIsMoneyCheck")>(),
      runWhereIsMoneyCheck
    }));

    try {
      const { runSingleDeepForensicJobCycle: runCycleWithMock } = await import("../../src/forensics/deepForensicJob");
      const sourceJob: ForensicCheckJob = {
        ...job(),
        kind: "where_is_money_check",
        priority: 120,
        progressJson: { fastRiskSnapshot: { score: 0, level: "LOW" }, locale: "en" }
      };
      const completeForensicCheckJob = vi.fn(async (_input: Parameters<Parameters<typeof runSingleDeepForensicJobCycle>[0]["completeForensicCheckJob"]>[0]) => true);
      const buildWhereIsMoneyJobResultPayload = vi.fn(async () => ({
        version: "telegram-message-payload-v1" as const,
        chatId: "42",
        text: "where-result",
        parseMode: "HTML" as const,
        replyMarkup: null
      }));

      const handled = await runCycleWithMock({
        claimNextForensicCheckJob: async () => sourceJob,
        completeForensicCheckJob,
        recordRiskEvaluation: vi.fn(async () => undefined),
        tronClient: {
          listRelatedTrc20Transfers: async () => []
        },
        getLabelsForAddress: async () => [],
        getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({ subjectAddress: address }),
        buildWhereIsMoneyJobResultPayload
      });

      expect(handled).toBe(true);
      expect(runWhereIsMoneyCheck.mock.calls[0]?.[1]).toMatchObject({
        contractTransactionInfoMinIntervalMs: 1000
      });
      expect(completeForensicCheckJob).toHaveBeenCalledWith(expect.objectContaining({
        status: "completed",
        progressJson: expect.objectContaining({
          whereIsMoneyCoverage: whereReport.coverage
        }),
        resultJson: expect.objectContaining({
          scoringPolicyVersion: SCORING_SIGNAL_MATRIX_POLICY_VERSION,
          subjectAddress: subject,
          whereIsMoneyReport: expect.objectContaining({
            ...whereReport,
            scoringPolicyVersion: SCORING_SIGNAL_MATRIX_POLICY_VERSION
          }),
          contractDrivenReceiverProfile: null,
          contractDrivenTransferProfiles: []
        })
      }));
      expect(buildWhereIsMoneyJobResultPayload).toHaveBeenCalledWith(sourceJob, expect.objectContaining({
        ...whereReport,
        scoringPolicyVersion: SCORING_SIGNAL_MATRIX_POLICY_VERSION
      }), "completed");
      expect(completeForensicCheckJob.mock.calls[0]?.[0].progressJson.telegramDelivery).toMatchObject({
        payload: { chatId: "42", text: "where-result" },
        state: { status: "pending", attemptCount: 0 },
        claim: null
      });
    } finally {
      vi.doUnmock("../../src/check/whereIsMoneyCheck");
      vi.resetModules();
    }
  });

  it("runs where-is-money jobs through the balance-origin path", async () => {
    const sourceJob: ForensicCheckJob = {
      ...job(),
      kind: "where_is_money_check",
      priority: 120,
      progressJson: { fastRiskSnapshot: { score: 9, level: "LOW" }, locale: "en" }
    };
    const transfersByAddress = new Map<string, RawTronscanTrc20Transfer[]>([
      [
        subject,
        [
          transfer({
            id: "tx-transit-subject",
            from: transit,
            to: subject,
            amountRaw: "95000000000",
            at: "2026-05-20T10:00:00.000Z"
          })
        ]
      ],
      [
        transit,
        [
          transfer({
            id: "tx-seed-transit",
            from: seed,
            to: transit,
            amountRaw: "100000000000",
            at: "2026-05-20T09:55:00.000Z"
          }),
          transfer({
            id: "tx-transit-subject",
            from: transit,
            to: subject,
            amountRaw: "95000000000",
            at: "2026-05-20T10:00:00.000Z"
          })
        ]
      ]
    ]);
    const completeForensicCheckJob = vi.fn(async (_input: Parameters<Parameters<typeof runSingleDeepForensicJobCycle>[0]["completeForensicCheckJob"]>[0]) => true);
    const buildWhereIsMoneyJobResultPayload = vi.fn(async () => ({
      version: "telegram-message-payload-v1" as const,
      chatId: "42",
      text: "where-result",
      parseMode: "HTML" as const,
      replyMarkup: null
    }));
    const recordRiskEvaluation = vi.fn(async () => undefined);

    const handled = await runSingleDeepForensicJobCycle({
      claimNextForensicCheckJob: async () => sourceJob,
      completeForensicCheckJob,
      recordRiskEvaluation,
      tronClient: {
        listRelatedTrc20Transfers: async (address) => transfersByAddress.get(address) ?? []
      },
      getLabelsForAddress: async (address) => address === seed ? [darknetExchangeLabel(address)] : [],
      getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({ subjectAddress: address, balanceRaw: address === subject ? "95000000000" : null }),
      buildWhereIsMoneyJobResultPayload
    }, {
      recentFallbackMinTransferCount: 60,
      maxEdgesPerAddress: 60,
      recentFallbackTransferLimit: 60
    });

    expect(handled).toBe(true);
    expect(recordRiskEvaluation).not.toHaveBeenCalled();
    expect(completeForensicCheckJob).toHaveBeenCalledWith(expect.objectContaining({
      id: "job-1",
      status: "completed",
      rawEvidenceIds: [],
      observationIds: [],
      lastError: null
    }));
    expect(completeForensicCheckJob.mock.calls[0][0].resultJson).toMatchObject({
      subjectAddress: subject,
      whereIsMoneyReport: {
        decision: "DECLINE",
        riskScore: expect.any(Number),
        coverage: expect.objectContaining({
          maxDepth: 20
        })
      }
    });
    expect(buildWhereIsMoneyJobResultPayload).toHaveBeenCalledWith(
      sourceJob,
      expect.objectContaining({ decision: "DECLINE" }),
      "completed"
    );
  });

  it("uses runtime where-is-money fetch limits for indexed and live edge pages", async () => {
    const sourceJob: ForensicCheckJob = {
      ...job(),
      kind: "where_is_money_check",
      priority: 120,
      progressJson: { fastRiskSnapshot: { score: 0, level: "LOW" }, locale: "en" }
    };
    const timestampMs = (value: unknown): number | null => {
      if (value instanceof Date) return value.getTime();
      if (typeof value === "number") return value;
      return null;
    };
    const indexedCalls: Array<{ address: string; minTimestampMs: number | null; maxTimestampMs: number | null; limit?: number }> = [];
    const liveCalls: Array<{ address: string; minTimestampMs: number | null; endTimestampMs: number | null; limit?: number }> = [];
    const completeForensicCheckJob = vi.fn(async (_input: Parameters<Parameters<typeof runSingleDeepForensicJobCycle>[0]["completeForensicCheckJob"]>[0]) => true);

    const handled = await runSingleDeepForensicJobCycle({
      claimNextForensicCheckJob: async () => sourceJob,
      completeForensicCheckJob,
      recordRiskEvaluation: vi.fn(async () => undefined),
      listIndexedUsdtTransfersForAddress: async (address, options) => {
        indexedCalls.push({
          address,
          minTimestampMs: timestampMs(options?.minTimestamp),
          maxTimestampMs: timestampMs(options?.maxTimestamp),
          limit: options?.limit
        });
        return [];
      },
      tronClient: {
        listRelatedTrc20Transfers: async (address, options) => {
          liveCalls.push({
            address,
            minTimestampMs: timestampMs(options?.minTimestamp),
            endTimestampMs: timestampMs(options?.endTimestamp),
            limit: options?.limit
          });
          return [];
        }
      },
      getLabelsForAddress: async () => [],
      getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({
        subjectAddress: address,
        balanceRaw: address === subject ? "1000000" : null
      })
    }, deepForensicRuntimeOptions({
      tronscanPageLimit: 100,
      crossChainStage2Enabled: false,
      crossChainStage2MaxProviderCalls: 3
    }, true));

    expect(handled).toBe(true);
    expect(indexedCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({ address: subject, minTimestampMs: sourceJob.windowStart.getTime(), limit: 150 }),
      expect.objectContaining({ address: subject, minTimestampMs: 0, limit: 150 })
    ]));
    expect(liveCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({ address: subject, minTimestampMs: sourceJob.windowStart.getTime(), limit: 100 }),
      expect.objectContaining({ address: subject, minTimestampMs: null, endTimestampMs: null, limit: 100 })
    ]));
    expect(liveCalls.every((call) => call.limit === undefined || call.limit <= 100)).toBe(true);
  });

  it("widens historical hop fetches when the target transfer is older than the job window", async () => {
    const oldSeedTimestamp = new Date("2026-04-01T10:00:00.000Z");
    const sourceJob: ForensicCheckJob = {
      ...job(),
      kind: "where_is_money_check",
      priority: 120,
      progressJson: { fastRiskSnapshot: { score: 0, level: "LOW" }, locale: "en", requestedAmountRaw: "1000000" }
    };
    const timestampMs = (value: unknown): number | null => {
      if (value instanceof Date) return value.getTime();
      if (typeof value === "number") return value;
      return null;
    };
    const indexedCalls: Array<{ address: string; minTimestampMs: number | null; maxTimestampMs: number | null }> = [];
    const liveCalls: Array<{ address: string; minTimestampMs: number | null; endTimestampMs: number | null }> = [];

    const handled = await runSingleDeepForensicJobCycle({
      claimNextForensicCheckJob: async () => sourceJob,
      completeForensicCheckJob: vi.fn(async () => true),
      recordRiskEvaluation: vi.fn(async () => undefined),
      listIndexedUsdtTransfersForAddress: async (address, options) => {
        indexedCalls.push({
          address,
          minTimestampMs: timestampMs(options?.minTimestamp),
          maxTimestampMs: timestampMs(options?.maxTimestamp)
        });
        if (address === subject && timestampMs(options?.minTimestamp) === 0) {
          return [indexedTransfer({
            txHash: "old-balance-seed",
            blockTimestamp: oldSeedTimestamp,
            fromAddress: transit,
            toAddress: subject,
            amountRaw: "1000000"
          })];
        }
        return [];
      },
      tronClient: {
        listRelatedTrc20Transfers: async (address, options) => {
          liveCalls.push({
            address,
            minTimestampMs: timestampMs(options?.minTimestamp),
            endTimestampMs: timestampMs(options?.endTimestamp)
          });
          return [];
        }
      },
      getLabelsForAddress: async () => [],
      getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({
        subjectAddress: address,
        balanceRaw: address === subject ? "1000000" : null
      })
    }, deepForensicRuntimeOptions({
      tronscanPageLimit: 100,
      crossChainStage2Enabled: false,
      crossChainStage2MaxProviderCalls: 3
    }, true));

    expect(handled).toBe(true);
    expect(indexedCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        address: transit,
        minTimestampMs: 0,
        maxTimestampMs: oldSeedTimestamp.getTime()
      })
    ]));
    expect(liveCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        address: transit,
        minTimestampMs: 0,
        endTimestampMs: oldSeedTimestamp.getTime()
      })
    ]));
  });

  it("target-indexes where-is-money hop history once before reading indexed edges", async () => {
    const hopTimestamp = new Date("2026-05-20T10:00:00.000Z");
    const sourceJob: ForensicCheckJob = {
      ...job(),
      kind: "where_is_money_check",
      priority: 120,
      progressJson: { fastRiskSnapshot: { score: 0, level: "LOW" }, locale: "en", requestedAmountRaw: "1000000" }
    };
    const events: string[] = [];
    const ensureAddressUsdtHistory = vi.fn(async (input: Parameters<NonNullable<Parameters<typeof runSingleDeepForensicJobCycle>[0]["ensureAddressUsdtHistory"]>>[0]) => {
      events.push(`ensure:${input.address}:${input.targetTimestamp?.getTime() ?? "none"}`);
      return {
        ...queuedIndexState(input.address),
        coverageMode: input.coverageMode,
        targetTimestamp: input.targetTimestamp ?? null,
        stopAtTimestamp: input.stopAtTimestamp ?? null,
        queuedReason: input.queuedReason,
        requestedByJobId: input.requestedByJobId ?? null
      };
    });
    const completeForensicCheckJob = vi.fn(async (_input: Parameters<Parameters<typeof runSingleDeepForensicJobCycle>[0]["completeForensicCheckJob"]>[0]) => true);

    const handled = await runSingleDeepForensicJobCycle({
      claimNextForensicCheckJob: async () => sourceJob,
      completeForensicCheckJob,
      recordRiskEvaluation: vi.fn(async () => undefined),
      ensureAddressUsdtHistory,
      listIndexedUsdtTransfersForAddress: async (address, options) => {
        const maxTimestamp = options?.maxTimestamp instanceof Date ? options.maxTimestamp.getTime() : null;
        events.push(`indexed:${address}:${maxTimestamp ?? "none"}`);
        if (address === subject) {
          return [indexedTransfer({
            txHash: "tx-transit-subject",
            blockTimestamp: hopTimestamp,
            fromAddress: transit,
            toAddress: subject,
            amountRaw: "1000000"
          })];
        }
        return [];
      },
      tronClient: {
        listRelatedTrc20Transfers: async () => []
      },
      getLabelsForAddress: async () => [],
      getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({
        subjectAddress: address,
        balanceRaw: address === subject ? "1000000" : null
      })
    }, {
      recentFallbackMinTransferCount: 60,
      maxEdgesPerAddress: 60,
      recentFallbackTransferLimit: 60
    });

    expect(handled).toBe(true);
    expect(ensureAddressUsdtHistory).toHaveBeenCalledTimes(1);
    expect(ensureAddressUsdtHistory).toHaveBeenCalledWith(expect.objectContaining({
      address: transit,
      coverageMode: "targeted",
      targetTimestamp: hopTimestamp,
      stopAtTimestamp: hopTimestamp,
      requestedByJobId: "job-1",
      queuedReason: "where_is_money_hop"
    }));
    const ensureEvent = `ensure:${transit}:${hopTimestamp.getTime()}`;
    const indexedEvent = `indexed:${transit}:${hopTimestamp.getTime()}`;
    expect(events.indexOf(ensureEvent)).toBeGreaterThanOrEqual(0);
    expect(events.indexOf(indexedEvent)).toBeGreaterThan(events.indexOf(ensureEvent));
  });

  it("moves strict benchmark jobs to waiting instead of synchronously ensuring targeted history", async () => {
    vi.resetModules();
    const runWhereIsMoneyCheck = vi.fn(async (deps: any) => {
      await deps.fetchEdgesForAddress("THop111111111111111111111111111111111", {
        latestTimestamp: new Date("2026-06-30T11:52:00.000Z")
      });
      throw new Error("strict wait should abort before scoring");
    });
    vi.doMock("../../src/check/whereIsMoneyCheck", async (importOriginal) => ({
      ...await importOriginal<typeof import("../../src/check/whereIsMoneyCheck")>(),
      runWhereIsMoneyCheck
    }));

    try {
      const { runSingleDeepForensicJobCycle: runCycleWithMock } = await import("../../src/forensics/deepForensicJob");
      const sourceJob: ForensicCheckJob = {
        ...job(),
        kind: "where_is_money_check",
        progressJson: {
          strictProvenanceBenchmark: true,
          mode: "wallet_profile",
          strictProvenance: { phase: "selecting_flows", scoreValid: false, waitingFor: null }
        }
      };
      const queueAddressUsdtHistory = vi.fn(async () => ({
        address: "THop111111111111111111111111111111111",
        coverageMode: "targeted",
        status: "queued",
        statusReason: null,
        targetTimestamp: new Date("2026-06-30T11:52:00.000Z"),
        requestedByJobId: sourceJob.id
      } as any));
      const getAddressUsdtIndexState = vi.fn(async () => null);
      const releaseForensicCheckJobToWaiting = vi.fn(async () => true);
      const completeForensicCheckJob = vi.fn(async () => true);

      const handled = await runCycleWithMock({
        claimNextForensicCheckJob: async () => sourceJob,
        completeForensicCheckJob,
        releaseForensicCheckJobToWaiting,
        updateForensicCheckJobProgress: vi.fn(async () => true),
        recordRiskEvaluation: vi.fn(async () => undefined),
        getAddressUsdtIndexState,
        queueAddressUsdtHistory,
        tronClient: { listRelatedTrc20Transfers: async () => [] },
        getLabelsForAddress: async () => [],
        getUsdtRestrictionStatus: async (address: string) => usdtRestrictionProfile({ subjectAddress: address })
      } as any);

      expect(handled).toBe(true);
      expect(getAddressUsdtIndexState).toHaveBeenCalledWith(expect.objectContaining({
        address: "THop111111111111111111111111111111111",
        coverageMode: "targeted"
      }));
      expect(queueAddressUsdtHistory).toHaveBeenCalledWith(expect.objectContaining({
        address: "THop111111111111111111111111111111111",
        coverageMode: "targeted",
        requestedByJobId: sourceJob.id,
        queuedReason: "where_is_money_hop"
      }));
      expect(releaseForensicCheckJobToWaiting).toHaveBeenCalledWith(expect.objectContaining({
        id: sourceJob.id,
        progressJson: expect.objectContaining({
          jobPhase: "waiting_for_targeted_index",
          strictProvenance: expect.objectContaining({
            phase: "waiting_for_targeted_index",
            scoreValid: false
          })
        })
      }));
      expect(completeForensicCheckJob).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock("../../src/check/whereIsMoneyCheck");
      vi.resetModules();
    }
  });

  it("moves ordinary where jobs to targeted index waiting instead of publishing a final score", async () => {
    vi.resetModules();
    const hopTimestamp = new Date("2026-05-20T11:52:00.000Z");
    const hopAddress = "THop111111111111111111111111111111111";
    const runWhereIsMoneyCheck = vi.fn(async (deps: any) => {
      await deps.fetchEdgesForAddress(hopAddress, { latestTimestamp: hopTimestamp });
      throw new Error("ordinary wait should abort before scoring");
    });
    vi.doMock("../../src/check/whereIsMoneyCheck", async (importOriginal) => ({
      ...await importOriginal<typeof import("../../src/check/whereIsMoneyCheck")>(),
      runWhereIsMoneyCheck
    }));

    try {
      const { runSingleDeepForensicJobCycle: runCycleWithMock } = await import("../../src/forensics/deepForensicJob");
      const sourceJob: ForensicCheckJob = {
        ...job(),
        kind: "where_is_money_check",
        progressJson: { mode: "wallet_profile" }
      };
      const queueAddressUsdtHistory = vi.fn(async (input: { address: string; targetTimestamp?: Date | null }) => ({
        ...queuedIndexState(input.address),
        coverageMode: "targeted",
        status: "queued",
        targetTimestamp: input.targetTimestamp ?? null,
        requestedByJobId: sourceJob.id,
        queuedReason: "where_is_money_hop"
      } as any));
      const getAddressUsdtIndexState = vi.fn(async () => null);
      const releaseForensicCheckJobToWaiting = vi.fn(async () => true);
      const upsertForensicJobWait = vi.fn(async () => undefined);
      const completeForensicCheckJob = vi.fn(async () => true);

      const handled = await runCycleWithMock({
        claimNextForensicCheckJob: async () => sourceJob,
        completeForensicCheckJob,
        releaseForensicCheckJobToWaiting,
        updateForensicCheckJobProgress: vi.fn(async () => true),
        recordRiskEvaluation: vi.fn(async () => undefined),
        getAddressUsdtIndexState,
        queueAddressUsdtHistory,
        upsertForensicJobWait,
        tronClient: { listRelatedTrc20Transfers: async () => [] },
        getLabelsForAddress: async () => [],
        getUsdtRestrictionStatus: async (address: string) => usdtRestrictionProfile({ subjectAddress: address })
      } as any);

      expect(handled).toBe(true);
      expect(queueAddressUsdtHistory).toHaveBeenCalledWith(expect.objectContaining({
        address: hopAddress,
        coverageMode: "targeted",
        targetTimestamp: hopTimestamp,
        requestedByJobId: sourceJob.id,
        queuedReason: "where_is_money_hop"
      }));
      expect(upsertForensicJobWait).toHaveBeenCalledWith({
        jobId: sourceJob.id,
        address: hopAddress,
        targetTimestamp: hopTimestamp,
        requiredFor: "where_hop",
        statusReason: null,
        lastError: null
      });
      expect(releaseForensicCheckJobToWaiting).toHaveBeenCalledWith(expect.objectContaining({
        id: sourceJob.id,
        progressJson: expect.objectContaining({
          jobPhase: "waiting_for_targeted_index",
          targetedIndex: expect.objectContaining({
            phase: "waiting_for_targeted_index",
            scoreValid: false,
            waitingFor: expect.objectContaining({
              address: hopAddress,
              targetTimestamp: hopTimestamp.toISOString(),
              requiredFor: "where_hop"
            })
          })
        })
      }));
      expect(completeForensicCheckJob).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock("../../src/check/whereIsMoneyCheck");
      vi.resetModules();
    }
  });

  it("queues candidate windows before broad targeted history for ordinary where jobs", async () => {
    vi.resetModules();
    const hopTimestamp = new Date("2026-07-04T12:00:00.000Z");
    const candidateTimestamp = new Date("2026-07-04T11:59:00.000Z");
    const hopAddress = "THopCandidate11111111111111111111111";
    const queueReasons: string[] = [];
    const coverageSnapshots: Array<{ reachedTargetHop?: unknown; coverageComplete?: unknown; statusReason?: unknown }> = [];
    const runWhereIsMoneyCheck = vi.fn(async (deps: any) => {
      await deps.fetchEdgesForAddress(hopAddress, {
        latestTimestamp: hopTimestamp,
        deferBroadTargetedHistory: true
      });
      coverageSnapshots.push(await deps.getHistoryCoverageForAddress(hopAddress, {
        latestTimestamp: hopTimestamp
      }));
      await deps.requestCandidateWindows([{
        address: hopAddress,
        targetTimestamp: hopTimestamp,
        windowStartTimestamp: candidateTimestamp,
        windowEndTimestamp: hopTimestamp,
        relatedHopTxHash: "hop-tx-1",
        candidateTxHash: "candidate-tx-1",
        requestedAmountRaw: "100000000",
        candidateAmountRaw: "100000000",
        coverageShare: 1
      }]);
      throw new Error("candidate wait should abort before scoring");
    });
    vi.doMock("../../src/check/whereIsMoneyCheck", async (importOriginal) => ({
      ...await importOriginal<typeof import("../../src/check/whereIsMoneyCheck")>(),
      runWhereIsMoneyCheck
    }));

    try {
      const { runSingleDeepForensicJobCycle: runCycleWithMock } = await import("../../src/forensics/deepForensicJob");
      const sourceJob: ForensicCheckJob = {
        ...job(),
        kind: "where_is_money_check",
        progressJson: { mode: "wallet_profile" }
      };
      const queueAddressUsdtHistory = vi.fn(async (input: any) => {
        queueReasons.push(input.queuedReason);
        return {
          ...queuedIndexState(input.address),
          coverageMode: "targeted",
          requestKind: input.requestKind ?? "broad_targeted",
          status: "queued",
          targetTimestamp: input.targetTimestamp ?? null,
          windowStartTimestamp: input.windowStartTimestamp ?? null,
          windowEndTimestamp: input.windowEndTimestamp ?? null,
          relatedHopTxHash: input.relatedHopTxHash ?? null,
          candidateTxHash: input.candidateTxHash ?? null,
          requestedByJobId: sourceJob.id,
          queuedReason: input.queuedReason
        } as any;
      });
      const completeForensicCheckJob = vi.fn(async () => true);

      const handled = await runCycleWithMock({
        claimNextForensicCheckJob: async () => sourceJob,
        completeForensicCheckJob,
        releaseForensicCheckJobToWaiting: vi.fn(async () => true),
        updateForensicCheckJobProgress: vi.fn(async () => true),
        recordRiskEvaluation: vi.fn(async () => undefined),
        getAddressUsdtIndexState: vi.fn(async () => null),
        queueAddressUsdtHistory,
        upsertForensicJobWait: vi.fn(async () => undefined),
        tronClient: { listRelatedTrc20Transfers: async () => [] },
        listIndexedUsdtTransfersForAddress: vi.fn(async () => []),
        getLabelsForAddress: async () => [],
        getUsdtRestrictionStatus: async (address: string) => usdtRestrictionProfile({ subjectAddress: address })
      } as any);

      expect(handled).toBe(true);
      expect(queueReasons).toEqual(["where_candidate_window"]);
      expect(queueAddressUsdtHistory).toHaveBeenCalledWith(expect.objectContaining({
        address: hopAddress,
        coverageMode: "targeted",
        requestKind: "candidate_window",
        queuedReason: "where_candidate_window",
        relatedHopTxHash: "hop-tx-1",
        candidateTxHash: "candidate-tx-1"
      }));
      expect(queueAddressUsdtHistory).not.toHaveBeenCalledWith(expect.objectContaining({
        queuedReason: "where_is_money_hop"
      }));
      expect(coverageSnapshots[0]).toMatchObject({
        reachedTargetHop: false,
        coverageComplete: false,
        statusReason: "partial_budget_exhausted"
      });
      expect(completeForensicCheckJob).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock("../../src/check/whereIsMoneyCheck");
      vi.resetModules();
    }
  });

  it("queues aggregate broad fallback targets before one waiting release", async () => {
    vi.resetModules();
    const firstTarget = new Date("2026-07-04T12:05:00.000Z");
    const secondTarget = new Date("2026-07-04T12:00:00.000Z");
    const firstAddress = "TAggregateOne111111111111111111111";
    const secondAddress = "TAggregateTwo111111111111111111111";
    const runWhereIsMoneyCheck = vi.fn(async (deps: any) => {
      await deps.ensureBroadTargetedHistories([
        {
          address: firstAddress,
          targetTimestamp: firstTarget,
          queuedReason: "where_is_money_hop",
          reason: "material_unresolved_after_candidate_windows"
        },
        {
          address: secondAddress,
          targetTimestamp: secondTarget,
          queuedReason: "where_is_money_hop",
          reason: "material_unresolved_after_candidate_windows"
        }
      ]);
      throw new Error("aggregate broad fallback wait should abort before scoring");
    });
    vi.doMock("../../src/check/whereIsMoneyCheck", async (importOriginal) => ({
      ...await importOriginal<typeof import("../../src/check/whereIsMoneyCheck")>(),
      runWhereIsMoneyCheck
    }));

    try {
      const { runSingleDeepForensicJobCycle: runCycleWithMock } = await import("../../src/forensics/deepForensicJob");
      const sourceJob: ForensicCheckJob = {
        ...job(),
        kind: "where_is_money_check",
        progressJson: { mode: "wallet_profile" }
      };
      const queueAddressUsdtHistory = vi.fn(async (input: any) => ({
        ...queuedIndexState(input.address),
        coverageMode: "targeted",
        requestKind: input.requestKind ?? "broad_targeted",
        status: "queued",
        targetTimestamp: input.targetTimestamp ?? null,
        requestedByJobId: input.requestedByJobId ?? null,
        queuedReason: input.queuedReason
      } as any));
      const releaseForensicCheckJobToWaiting = vi.fn(async () => true);
      const upsertForensicJobWait = vi.fn(async () => undefined);
      const completeForensicCheckJob = vi.fn(async () => true);

      const handled = await runCycleWithMock({
        claimNextForensicCheckJob: async () => sourceJob,
        completeForensicCheckJob,
        releaseForensicCheckJobToWaiting,
        updateForensicCheckJobProgress: vi.fn(async () => true),
        recordRiskEvaluation: vi.fn(async () => undefined),
        getAddressUsdtIndexState: vi.fn(async () => null),
        getCoveringAddressUsdtIndexState: vi.fn(async () => null),
        queueAddressUsdtHistory,
        upsertForensicJobWait,
        tronClient: { listRelatedTrc20Transfers: async () => [] },
        listIndexedUsdtTransfersForAddress: vi.fn(async () => []),
        getLabelsForAddress: async () => [],
        getUsdtRestrictionStatus: async (address: string) => usdtRestrictionProfile({ subjectAddress: address })
      } as any);

      expect(handled).toBe(true);
      expect(queueAddressUsdtHistory).toHaveBeenCalledTimes(2);
      expect(queueAddressUsdtHistory).toHaveBeenCalledWith(expect.objectContaining({
        address: firstAddress,
        requestKind: "broad_targeted",
        queuedReason: "where_is_money_hop",
        targetTimestamp: firstTarget
      }));
      expect(queueAddressUsdtHistory).toHaveBeenCalledWith(expect.objectContaining({
        address: secondAddress,
        requestKind: "broad_targeted",
        queuedReason: "where_is_money_hop",
        targetTimestamp: secondTarget
      }));
      expect(upsertForensicJobWait).toHaveBeenCalledTimes(2);
      expect(releaseForensicCheckJobToWaiting).toHaveBeenCalledOnce();
      expect(releaseForensicCheckJobToWaiting).toHaveBeenCalledWith(expect.objectContaining({
        id: sourceJob.id,
        progressJson: expect.objectContaining({
          jobPhase: "waiting_for_targeted_index",
          targetedIndex: expect.objectContaining({
            broadFallback: "queued",
            broadFallbackBatch: expect.objectContaining({
              total: 2,
              waiting: 2
            })
          })
        })
      }));
      expect(completeForensicCheckJob).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock("../../src/check/whereIsMoneyCheck");
      vi.resetModules();
    }
  });

  it("uses a balance-forming slice instead of broad targeted wait for deferred where target hops", async () => {
    vi.resetModules();
    const hopTimestamp = new Date("2026-07-04T12:00:00.000Z");
    const hopAddress = "THopBalanceSlice111111111111111111111";
    const targetEdge: ForensicRouteEdge = {
      id: "tx-hop-balance-slice",
      txHash: "tx-hop-balance-slice",
      fromAddress: hopAddress,
      toAddress: subject,
      amountRaw: "100000000",
      timestamp: hopTimestamp,
      method: "transfer",
      edgeType: "normal_transfer"
    };
    const coverageSnapshots: Array<{ balanceFormingSlice?: { status?: unknown } | null }> = [];
    const runWhereIsMoneyCheck = vi.fn(async (deps: any) => {
      await deps.fetchEdgesForAddress(hopAddress, {
        latestTimestamp: hopTimestamp,
        deferBroadTargetedHistory: true,
        targetEdge,
        expectedAmountRaw: targetEdge.amountRaw
      });
      coverageSnapshots.push(await deps.getHistoryCoverageForAddress(hopAddress, {
        latestTimestamp: hopTimestamp,
        deferBroadTargetedHistory: true,
        targetEdge,
        expectedAmountRaw: targetEdge.amountRaw
      }));
      return {
        subjectAddress: subject,
        decision: "REVIEW",
        riskScore: 10,
        coverage: { partial: false, notes: [] },
        originPaths: [],
        balanceFormingTransfers: []
      } as unknown as WhereIsMoneyReport;
    });
    vi.doMock("../../src/check/whereIsMoneyCheck", async (importOriginal) => ({
      ...await importOriginal<typeof import("../../src/check/whereIsMoneyCheck")>(),
      runWhereIsMoneyCheck
    }));

    try {
      const { runSingleDeepForensicJobCycle: runCycleWithMock } = await import("../../src/forensics/deepForensicJob");
      const sourceJob: ForensicCheckJob = {
        ...job(),
        kind: "where_is_money_check",
        windowEnd: new Date("2026-07-05T00:00:00.000Z"),
        progressJson: { mode: "wallet_profile" }
      };
      const queueAddressUsdtHistory = vi.fn(async (input: { address: string; targetTimestamp?: Date | null; queuedReason: string }) => ({
        ...queuedIndexState(input.address),
        coverageMode: "targeted",
        status: "queued",
        targetTimestamp: input.targetTimestamp ?? null,
        requestedByJobId: sourceJob.id,
        queuedReason: input.queuedReason
      } as any));
      const releaseForensicCheckJobToWaiting = vi.fn(async () => true);
      const progressSnapshots: Record<string, any>[] = [];
      const updateForensicCheckJobProgress = vi.fn(async (input: { progressJson: Record<string, any> }) => {
        progressSnapshots.push(input.progressJson);
        return true;
      });
      const listRelatedTrc20Transfers = vi.fn(async (_address: string, options?: { start?: number }) => {
        if (options?.start === 0) {
          return Array.from({ length: 50 }, (_, index) => transfer({
            id: `tx-noise-${index}`,
            from: `TNoiseFrom${index.toString().padStart(2, "0")}1111111111111111111`,
            to: `TNoiseTo${index.toString().padStart(2, "0")}111111111111111111111`,
            amountRaw: "1",
            at: "2026-07-04T11:59:00.000Z"
          }));
        }
        return [
          transfer({
            id: "tx-funds-hop",
            from: "TFunderBalanceSlice111111111111111111",
            to: hopAddress,
            amountRaw: "100000000",
            at: "2026-07-04T11:58:00.000Z"
          })
        ];
      });

      const handled = await runCycleWithMock({
        claimNextForensicCheckJob: async () => sourceJob,
        completeForensicCheckJob: vi.fn(async () => true),
        releaseForensicCheckJobToWaiting,
        updateForensicCheckJobProgress,
        recordRiskEvaluation: vi.fn(async () => undefined),
        getAddressUsdtIndexState: vi.fn(async () => null),
        getCoveringAddressUsdtIndexState: vi.fn(async () => null),
        queueAddressUsdtHistory,
        upsertForensicJobWait: vi.fn(async () => undefined),
        tronClient: { listRelatedTrc20Transfers },
        getLabelsForAddress: async () => [],
        getUsdtRestrictionStatus: async (address: string) => usdtRestrictionProfile({ subjectAddress: address })
      } as any);

      expect(handled).toBe(true);
      expect(queueAddressUsdtHistory).not.toHaveBeenCalledWith(expect.objectContaining({
        queuedReason: "where_is_money_hop"
      }));
      expect(releaseForensicCheckJobToWaiting).not.toHaveBeenCalled();
      expect(progressSnapshots).toEqual(expect.arrayContaining([
        expect.objectContaining({
          jobPhase: "checking_balance_forming_slice",
          balanceFormingSlice: expect.objectContaining({
            phase: "checking_balance_forming_slice",
            source: "live_bounded_slice",
            address: hopAddress,
            targetTxHash: targetEdge.txHash,
            relatedHopTxHash: targetEdge.txHash,
            fetchedPageCount: 0,
            fetchedTransferCount: 0
          })
        }),
        expect.objectContaining({
          jobPhase: "checking_balance_forming_slice",
          balanceFormingSlice: expect.objectContaining({
            phase: "completed",
            status: "covered",
            source: "live_bounded_slice",
            address: hopAddress,
            targetTxHash: targetEdge.txHash,
            coveredAmountRaw: "100000000",
            coverageRatio: 1,
            providerCapHit: false,
            budgetExhausted: false,
            providerInconsistent: false
          })
        })
      ]));
      expect(listRelatedTrc20Transfers).toHaveBeenNthCalledWith(1, hopAddress, expect.objectContaining({
        start: 0,
        limit: 50,
        endTimestamp: hopTimestamp.getTime()
      }));
      expect(listRelatedTrc20Transfers).toHaveBeenNthCalledWith(2, hopAddress, expect.objectContaining({
        start: 50,
        limit: 50,
        endTimestamp: hopTimestamp.getTime()
      }));
      expect(coverageSnapshots[0]?.balanceFormingSlice).toMatchObject({
        status: "covered",
        fetchedPageCount: 2,
        coveredAmountRaw: "100000000"
      });
      expect(coverageSnapshots[0]).toMatchObject({
        reachedTargetHop: true,
        coverageComplete: true,
        providerCapHit: false,
        budgetExhausted: false,
        statusReason: null
      });
    } finally {
      vi.doUnmock("../../src/check/whereIsMoneyCheck");
      vi.resetModules();
    }
  });

  it("does not reuse a deferred balance-forming slice as latest-only targeted coverage", async () => {
    vi.resetModules();
    const hopTimestamp = new Date("2026-07-04T12:00:00.000Z");
    const hopAddress = "THopBalanceSliceCache1111111111111111";
    const targetEdge: ForensicRouteEdge = {
      id: "tx-hop-balance-slice-cache",
      txHash: "tx-hop-balance-slice-cache",
      fromAddress: hopAddress,
      toAddress: subject,
      amountRaw: "100000000",
      timestamp: hopTimestamp,
      method: "transfer",
      edgeType: "normal_transfer"
    };
    const coverageSnapshots: Array<{ balanceFormingSlice?: { status?: unknown } | null }> = [];
    const runWhereIsMoneyCheck = vi.fn(async (deps: any) => {
      await deps.fetchEdgesForAddress(hopAddress, {
        latestTimestamp: hopTimestamp,
        deferBroadTargetedHistory: true,
        targetEdge,
        expectedAmountRaw: targetEdge.amountRaw
      });
      coverageSnapshots.push(await deps.getHistoryCoverageForAddress(hopAddress, {
        latestTimestamp: hopTimestamp,
        deferBroadTargetedHistory: true,
        targetEdge,
        expectedAmountRaw: targetEdge.amountRaw
      }));
      await deps.getHistoryCoverageForAddress(hopAddress, {
        latestTimestamp: hopTimestamp
      });
      return {
        subjectAddress: subject,
        decision: "REVIEW",
        riskScore: 10,
        coverage: { partial: false, notes: [] },
        originPaths: [],
        balanceFormingTransfers: []
      } as unknown as WhereIsMoneyReport;
    });
    vi.doMock("../../src/check/whereIsMoneyCheck", async (importOriginal) => ({
      ...await importOriginal<typeof import("../../src/check/whereIsMoneyCheck")>(),
      runWhereIsMoneyCheck
    }));

    try {
      const { runSingleDeepForensicJobCycle: runCycleWithMock } = await import("../../src/forensics/deepForensicJob");
      const sourceJob: ForensicCheckJob = {
        ...job(),
        kind: "where_is_money_check",
        windowEnd: new Date("2026-07-05T00:00:00.000Z"),
        progressJson: { mode: "wallet_profile" }
      };
      const queueAddressUsdtHistory = vi.fn(async (input: { address: string; targetTimestamp?: Date | null; queuedReason: string }) => ({
        ...queuedIndexState(input.address),
        coverageMode: "targeted",
        status: "queued",
        targetTimestamp: input.targetTimestamp ?? null,
        requestedByJobId: sourceJob.id,
        queuedReason: input.queuedReason
      } as any));
      const releaseForensicCheckJobToWaiting = vi.fn(async () => true);
      const completeForensicCheckJob = vi.fn(async () => true);

      const handled = await runCycleWithMock({
        claimNextForensicCheckJob: async () => sourceJob,
        completeForensicCheckJob,
        releaseForensicCheckJobToWaiting,
        updateForensicCheckJobProgress: vi.fn(async () => true),
        recordRiskEvaluation: vi.fn(async () => undefined),
        getAddressUsdtIndexState: vi.fn(async () => null),
        getCoveringAddressUsdtIndexState: vi.fn(async () => null),
        queueAddressUsdtHistory,
        upsertForensicJobWait: vi.fn(async () => undefined),
        tronClient: {
          listRelatedTrc20Transfers: vi.fn(async () => [
            transfer({
              id: "tx-funds-hop-cache",
              from: "TFunderBalanceSliceCache11111111111",
              to: hopAddress,
              amountRaw: "100000000",
              at: "2026-07-04T11:58:00.000Z"
            })
          ])
        },
        getLabelsForAddress: async () => [],
        getUsdtRestrictionStatus: async (address: string) => usdtRestrictionProfile({ subjectAddress: address })
      } as any);

      expect(handled).toBe(true);
      expect(coverageSnapshots[0]?.balanceFormingSlice).toMatchObject({
        status: "covered",
        coveredAmountRaw: "100000000"
      });
      expect(queueAddressUsdtHistory).toHaveBeenCalledWith(expect.objectContaining({
        address: hopAddress,
        coverageMode: "targeted",
        targetTimestamp: hopTimestamp,
        queuedReason: "where_is_money_hop"
      }));
      expect(releaseForensicCheckJobToWaiting).toHaveBeenCalledOnce();
      expect(completeForensicCheckJob).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock("../../src/check/whereIsMoneyCheck");
      vi.resetModules();
    }
  });

  it("keys deferred balance-forming slice cache by concrete target hop", async () => {
    vi.resetModules();
    const hopTimestamp = new Date("2026-07-04T12:00:00.000Z");
    const hopAddress = "THopBalanceSliceTarget111111111111111";
    const firstTarget: ForensicRouteEdge = {
      id: "tx-hop-balance-slice-target-one",
      txHash: "tx-hop-balance-slice-target-one",
      fromAddress: hopAddress,
      toAddress: subject,
      amountRaw: "100000000",
      timestamp: hopTimestamp,
      method: "transfer",
      edgeType: "normal_transfer"
    };
    const secondTarget: ForensicRouteEdge = {
      ...firstTarget,
      id: "tx-hop-balance-slice-target-two",
      txHash: "tx-hop-balance-slice-target-two",
      amountRaw: "200000000"
    };
    const coverageSnapshots: Array<{ balanceFormingSlice?: { targetTxHash?: string; coveredAmountRaw?: string } | null }> = [];
    const runWhereIsMoneyCheck = vi.fn(async (deps: any) => {
      for (const targetEdge of [firstTarget, secondTarget]) {
        await deps.fetchEdgesForAddress(hopAddress, {
          latestTimestamp: hopTimestamp,
          deferBroadTargetedHistory: true,
          targetEdge,
          expectedAmountRaw: targetEdge.amountRaw
        });
        coverageSnapshots.push(await deps.getHistoryCoverageForAddress(hopAddress, {
          latestTimestamp: hopTimestamp,
          deferBroadTargetedHistory: true,
          targetEdge,
          expectedAmountRaw: targetEdge.amountRaw
        }));
      }
      return {
        subjectAddress: subject,
        decision: "REVIEW",
        riskScore: 10,
        coverage: { partial: false, notes: [] },
        originPaths: [],
        balanceFormingTransfers: []
      } as unknown as WhereIsMoneyReport;
    });
    vi.doMock("../../src/check/whereIsMoneyCheck", async (importOriginal) => ({
      ...await importOriginal<typeof import("../../src/check/whereIsMoneyCheck")>(),
      runWhereIsMoneyCheck
    }));

    try {
      const { runSingleDeepForensicJobCycle: runCycleWithMock } = await import("../../src/forensics/deepForensicJob");
      const sourceJob: ForensicCheckJob = {
        ...job(),
        kind: "where_is_money_check",
        windowEnd: new Date("2026-07-05T00:00:00.000Z"),
        progressJson: { mode: "wallet_profile" }
      };
      let fetchCount = 0;
      const listRelatedTrc20Transfers = vi.fn(async () => {
        fetchCount += 1;
        return [
          transfer({
            id: `tx-funds-target-${fetchCount}`,
            from: `TFunderBalanceSliceTarget${fetchCount}111111111`,
            to: hopAddress,
            amountRaw: fetchCount === 1 ? "100000000" : "200000000",
            at: "2026-07-04T11:58:00.000Z"
          })
        ];
      });

      const handled = await runCycleWithMock({
        claimNextForensicCheckJob: async () => sourceJob,
        completeForensicCheckJob: vi.fn(async () => true),
        releaseForensicCheckJobToWaiting: vi.fn(async () => true),
        updateForensicCheckJobProgress: vi.fn(async () => true),
        recordRiskEvaluation: vi.fn(async () => undefined),
        getAddressUsdtIndexState: vi.fn(async () => null),
        getCoveringAddressUsdtIndexState: vi.fn(async () => null),
        queueAddressUsdtHistory: vi.fn(async () => {
          throw new Error("balance slice should not queue broad targeted history");
        }),
        upsertForensicJobWait: vi.fn(async () => undefined),
        tronClient: { listRelatedTrc20Transfers },
        getLabelsForAddress: async () => [],
        getUsdtRestrictionStatus: async (address: string) => usdtRestrictionProfile({ subjectAddress: address })
      } as any);

      expect(handled).toBe(true);
      expect(listRelatedTrc20Transfers).toHaveBeenCalledTimes(2);
      expect(coverageSnapshots.map((coverage) => coverage.balanceFormingSlice)).toEqual([
        expect.objectContaining({
          targetTxHash: firstTarget.txHash,
          coveredAmountRaw: "100000000"
        }),
        expect.objectContaining({
          targetTxHash: secondTarget.txHash,
          coveredAmountRaw: "200000000"
        })
      ]);
    } finally {
      vi.doUnmock("../../src/check/whereIsMoneyCheck");
      vi.resetModules();
    }
  });

  it("uses completed broad targeted history instead of a deferred balance-forming slice", async () => {
    vi.resetModules();
    const hopTimestamp = new Date("2026-07-04T12:00:00.000Z");
    const hopAddress = "THopBalanceSliceBroad1111111111111111";
    const targetEdge: ForensicRouteEdge = {
      id: "tx-hop-balance-slice-broad",
      txHash: "tx-hop-balance-slice-broad",
      fromAddress: hopAddress,
      toAddress: subject,
      amountRaw: "100000000",
      timestamp: hopTimestamp,
      method: "transfer",
      edgeType: "normal_transfer"
    };
    let coverageSnapshot: any = null;
    const runWhereIsMoneyCheck = vi.fn(async (deps: any) => {
      await deps.fetchEdgesForAddress(hopAddress, {
        latestTimestamp: hopTimestamp,
        deferBroadTargetedHistory: true,
        targetEdge,
        expectedAmountRaw: targetEdge.amountRaw
      });
      coverageSnapshot = await deps.getHistoryCoverageForAddress(hopAddress, {
        latestTimestamp: hopTimestamp,
        deferBroadTargetedHistory: true,
        targetEdge,
        expectedAmountRaw: targetEdge.amountRaw
      });
      return {
        subjectAddress: subject,
        decision: "REVIEW",
        riskScore: 10,
        coverage: { partial: false, notes: [] },
        originPaths: [],
        balanceFormingTransfers: []
      } as unknown as WhereIsMoneyReport;
    });
    vi.doMock("../../src/check/whereIsMoneyCheck", async (importOriginal) => ({
      ...await importOriginal<typeof import("../../src/check/whereIsMoneyCheck")>(),
      runWhereIsMoneyCheck
    }));

    try {
      const { runSingleDeepForensicJobCycle: runCycleWithMock } = await import("../../src/forensics/deepForensicJob");
      const sourceJob: ForensicCheckJob = {
        ...job(),
        kind: "where_is_money_check",
        windowEnd: new Date("2026-07-05T00:00:00.000Z"),
        progressJson: { mode: "wallet_profile" }
      };
      const listIndexedUsdtTransfersForAddress = vi.fn(async (address: string) => {
        if (address !== hopAddress) return [];
        return [
          indexedTransfer({
            txHash: "tx-indexed-broad-funding",
            fromAddress: "TFunderBalanceSliceBroad1111111111",
            toAddress: hopAddress,
            amountRaw: "100000000",
            blockTimestamp: new Date("2026-07-04T11:58:00.000Z")
          })
        ];
      });
      const queueAddressUsdtHistory = vi.fn(async () => {
        throw new Error("completed broad targeted history should not queue");
      });
      const releaseForensicCheckJobToWaiting = vi.fn(async () => true);
      const listRelatedTrc20TransferPage = vi.fn(async () => ({
        transfers: [],
        rangeTotal: null
      }));

      const handled = await runCycleWithMock({
        claimNextForensicCheckJob: async () => sourceJob,
        completeForensicCheckJob: vi.fn(async () => true),
        releaseForensicCheckJobToWaiting,
        updateForensicCheckJobProgress: vi.fn(async () => true),
        recordRiskEvaluation: vi.fn(async () => undefined),
        getAddressUsdtIndexState: vi.fn(async (input: { address: string; targetTimestamp?: Date | null }) => ({
          ...queuedIndexState(input.address),
          coverageMode: "targeted",
          requestKind: "broad_targeted",
          status: "complete",
          statusReason: "complete_provider_windowed",
          targetTimestamp: input.targetTimestamp ?? null
        } as any)),
        getCoveringAddressUsdtIndexState: vi.fn(async () => null),
        queueAddressUsdtHistory,
        upsertForensicJobWait: vi.fn(async () => undefined),
        listIndexedUsdtTransfersForAddress,
        tronClient: {
          listRelatedTrc20Transfers: vi.fn(async () => {
            throw new Error("complete broad targeted history should not be downgraded by live fallback");
          }),
          listRelatedTrc20TransferPage
        },
        getLabelsForAddress: async () => [],
        getUsdtRestrictionStatus: async (address: string) => usdtRestrictionProfile({ subjectAddress: address })
      } as any, {
        maxEdgesPerAddress: 2,
        recentFallbackTransferLimit: 2
      });

      expect(handled).toBe(true);
      expect(listIndexedUsdtTransfersForAddress).toHaveBeenCalledWith(hopAddress, expect.objectContaining({
        maxTimestamp: hopTimestamp
      }));
      expect(listRelatedTrc20TransferPage).not.toHaveBeenCalled();
      expect(queueAddressUsdtHistory).not.toHaveBeenCalled();
      expect(releaseForensicCheckJobToWaiting).not.toHaveBeenCalled();
      expect(coverageSnapshot).toMatchObject({
        source: "local_index",
        reachedTargetHop: true,
        coverageComplete: true,
        providerCapHit: false,
        budgetExhausted: false,
        providerInconsistent: false,
        statusReason: null
      });
      expect(coverageSnapshot.balanceFormingSlice).toBeUndefined();
    } finally {
      vi.doUnmock("../../src/check/whereIsMoneyCheck");
      vi.resetModules();
    }
  });

  it("does not downgrade complete broad targeted coverage when local indexed materialization is full", async () => {
    vi.resetModules();
    const hopTimestamp = new Date("2026-07-04T12:00:00.000Z");
    const hopAddress = "THopCompleteBroadFull111111111111111";
    let coverageSnapshot: any = null;
    const runWhereIsMoneyCheck = vi.fn(async (deps: any) => {
      await deps.fetchEdgesForAddress(hopAddress, {
        latestTimestamp: hopTimestamp,
        deferBroadTargetedHistory: true
      });
      coverageSnapshot = await deps.getHistoryCoverageForAddress(hopAddress, {
        latestTimestamp: hopTimestamp,
        deferBroadTargetedHistory: true
      });
      return {
        subjectAddress: subject,
        decision: "REVIEW",
        riskScore: 10,
        coverage: { partial: false, notes: [] },
        originPaths: [],
        balanceFormingTransfers: []
      } as unknown as WhereIsMoneyReport;
    });
    vi.doMock("../../src/check/whereIsMoneyCheck", async (importOriginal) => ({
      ...await importOriginal<typeof import("../../src/check/whereIsMoneyCheck")>(),
      runWhereIsMoneyCheck
    }));

    try {
      const { runSingleDeepForensicJobCycle: runCycleWithMock } = await import("../../src/forensics/deepForensicJob");
      const sourceJob: ForensicCheckJob = {
        ...job(),
        kind: "where_is_money_check",
        windowEnd: new Date("2026-07-05T00:00:00.000Z"),
        progressJson: { mode: "wallet_profile" }
      };
      const indexedRows = [
        indexedTransfer({
          txHash: "tx-complete-broad-full-one",
          fromAddress: "TCompleteBroadNoise11111111111111",
          toAddress: hopAddress,
          amountRaw: "1",
          blockTimestamp: new Date("2026-07-04T11:58:00.000Z")
        }),
        indexedTransfer({
          txHash: "tx-complete-broad-full-two",
          fromAddress: "TCompleteBroadNoise22222222222222",
          toAddress: hopAddress,
          amountRaw: "1",
          blockTimestamp: new Date("2026-07-04T11:57:00.000Z")
        })
      ];
      const listIndexedUsdtTransfersForAddress = vi.fn(async (address: string, options: { offset?: number; limit: number }) => {
        if (address !== hopAddress) return [];
        const offset = options.offset ?? 0;
        return indexedRows.slice(offset, offset + options.limit);
      });

      const handled = await runCycleWithMock({
        claimNextForensicCheckJob: async () => sourceJob,
        completeForensicCheckJob: vi.fn(async () => true),
        releaseForensicCheckJobToWaiting: vi.fn(async () => true),
        updateForensicCheckJobProgress: vi.fn(async () => true),
        recordRiskEvaluation: vi.fn(async () => undefined),
        getAddressUsdtIndexState: vi.fn(async (input: { address: string; targetTimestamp?: Date | null }) => ({
          ...queuedIndexState(input.address),
          coverageMode: "targeted",
          requestKind: "broad_targeted",
          status: "complete",
          statusReason: "complete_provider_windowed",
          targetTimestamp: input.targetTimestamp ?? null
        } as any)),
        getCoveringAddressUsdtIndexState: vi.fn(async () => null),
        queueAddressUsdtHistory: vi.fn(async () => {
          throw new Error("completed broad targeted history should not queue");
        }),
        upsertForensicJobWait: vi.fn(async () => undefined),
        listIndexedUsdtTransfersForAddress,
        tronClient: {
          listRelatedTrc20Transfers: vi.fn(async () => {
            throw new Error("complete broad targeted history should not require live fallback");
          })
        },
        getLabelsForAddress: async () => [],
        getUsdtRestrictionStatus: async (address: string) => usdtRestrictionProfile({ subjectAddress: address })
      } as any, {
        maxEdgesPerAddress: 2,
        recentFallbackTransferLimit: 2
      });

      expect(handled).toBe(true);
      expect(coverageSnapshot).toMatchObject({
        reachedTargetHop: true,
        coverageComplete: true,
        providerCapHit: false,
        budgetExhausted: false,
        providerInconsistent: false,
        statusReason: null,
        source: "local_index"
      });
    } finally {
      vi.doUnmock("../../src/check/whereIsMoneyCheck");
      vi.resetModules();
    }
  });

  it("does not suppress live acquisition for a different window on a locally materialized address", async () => {
    vi.resetModules();
    const hopTimestamp = new Date("2026-07-04T12:00:00.000Z");
    const hopAddress = "THopMaterializedWindow1111111111111111";
    const listRelatedTrc20Transfers = vi.fn(async () => [transfer({
      id: "tx-different-window-live",
      from: "TDifferentWindowFunder111111111111111",
      to: hopAddress,
      amountRaw: "100000000",
      at: "2026-07-04T13:00:00.000Z"
    })]);
    let targetedLiveCallCount = -1;
    let secondWindowEdges: ForensicRouteEdge[] = [];
    const runWhereIsMoneyCheck = vi.fn(async (deps: any) => {
      const targetedOptions = {
        latestTimestamp: hopTimestamp,
        deferBroadTargetedHistory: true
      };
      await deps.fetchEdgesForAddress(hopAddress, targetedOptions);
      await deps.fetchEdgesForAddress(hopAddress, targetedOptions);
      targetedLiveCallCount = listRelatedTrc20Transfers.mock.calls.length;
      secondWindowEdges = await deps.fetchEdgesForAddress(hopAddress);
      return {
        subjectAddress: subject,
        decision: "REVIEW",
        riskScore: 10,
        coverage: { partial: false, notes: [] },
        originPaths: [],
        balanceFormingTransfers: []
      } as unknown as WhereIsMoneyReport;
    });
    vi.doMock("../../src/check/whereIsMoneyCheck", async (importOriginal) => ({
      ...await importOriginal<typeof import("../../src/check/whereIsMoneyCheck")>(),
      runWhereIsMoneyCheck
    }));

    try {
      const { runSingleDeepForensicJobCycle: runCycleWithMock } = await import("../../src/forensics/deepForensicJob");
      const sourceJob: ForensicCheckJob = {
        ...job(),
        kind: "where_is_money_check",
        windowEnd: new Date("2026-07-05T00:00:00.000Z"),
        progressJson: { mode: "wallet_profile" }
      };
      const listIndexedUsdtTransfersForAddress = vi.fn(async (_address: string, options: { maxTimestamp: Date }) => {
        if (options.maxTimestamp.getTime() === hopTimestamp.getTime()) {
          throw new Error("targeted local window unavailable");
        }
        return [];
      });

      const handled = await runCycleWithMock({
        claimNextForensicCheckJob: async () => sourceJob,
        completeForensicCheckJob: vi.fn(async () => true),
        releaseForensicCheckJobToWaiting: vi.fn(async () => true),
        updateForensicCheckJobProgress: vi.fn(async () => true),
        recordRiskEvaluation: vi.fn(async () => undefined),
        getAddressUsdtIndexState: vi.fn(async (input: { address: string; targetTimestamp?: Date | null }) => ({
          ...queuedIndexState(input.address),
          coverageMode: "targeted",
          requestKind: "broad_targeted",
          status: "complete",
          statusReason: "complete_provider_windowed",
          targetTimestamp: input.targetTimestamp ?? null
        } as TronAddressUsdtIndexState)),
        getCoveringAddressUsdtIndexState: vi.fn(async () => null),
        queueAddressUsdtHistory: vi.fn(async () => {
          throw new Error("complete targeted window must not requeue");
        }),
        upsertForensicJobWait: vi.fn(async () => undefined),
        listIndexedUsdtTransfersForAddress,
        tronClient: { listRelatedTrc20Transfers },
        getLabelsForAddress: async () => [],
        getUsdtRestrictionStatus: async (address: string) => usdtRestrictionProfile({ subjectAddress: address })
      } as any, {
        maxEdgesPerAddress: 2,
        recentFallbackTransferLimit: 2
      });

      expect(handled).toBe(true);
      expect(targetedLiveCallCount).toBe(0);
      expect(listRelatedTrc20Transfers).toHaveBeenCalledTimes(1);
      expect(listRelatedTrc20Transfers).toHaveBeenCalledWith(hopAddress, expect.objectContaining({
        endTimestamp: sourceJob.windowEnd.getTime()
      }));
      expect(secondWindowEdges.map((edge) => edge.txHash)).toEqual(["tx-different-window-live"]);
    } finally {
      vi.doUnmock("../../src/check/whereIsMoneyCheck");
      vi.resetModules();
    }
  });

  it("does not mark latest-only local live truncation as provider cap", async () => {
    vi.resetModules();
    const hopTimestamp = new Date("2026-07-04T12:00:00.000Z");
    const hopAddress = "THopLocalBudgetOnly11111111111111111";
    let coverageSnapshot: any = null;
    const runWhereIsMoneyCheck = vi.fn(async (deps: any) => {
      await deps.fetchEdgesForAddress(hopAddress, { latestTimestamp: hopTimestamp });
      coverageSnapshot = await deps.getHistoryCoverageForAddress(hopAddress, { latestTimestamp: hopTimestamp });
      return {
        subjectAddress: subject,
        decision: "REVIEW",
        riskScore: 10,
        coverage: { partial: false, notes: [] },
        originPaths: [],
        balanceFormingTransfers: []
      } as unknown as WhereIsMoneyReport;
    });
    vi.doMock("../../src/check/whereIsMoneyCheck", async (importOriginal) => ({
      ...await importOriginal<typeof import("../../src/check/whereIsMoneyCheck")>(),
      runWhereIsMoneyCheck
    }));

    try {
      const { runSingleDeepForensicJobCycle: runCycleWithMock } = await import("../../src/forensics/deepForensicJob");
      const sourceJob: ForensicCheckJob = {
        ...job(),
        kind: "where_is_money_check",
        windowEnd: new Date("2026-07-05T00:00:00.000Z"),
        progressJson: { mode: "wallet_profile" }
      };
      const handled = await runCycleWithMock({
        claimNextForensicCheckJob: async () => sourceJob,
        completeForensicCheckJob: vi.fn(async () => true),
        updateForensicCheckJobProgress: vi.fn(async () => true),
        recordRiskEvaluation: vi.fn(async () => undefined),
        upsertForensicJobWait: vi.fn(async () => undefined),
        listIndexedUsdtTransfersForAddress: vi.fn(async () => []),
        tronClient: {
          listRelatedTrc20Transfers: vi.fn(async () =>
            Array.from({ length: 2 }, (_, index) => transfer({
              id: `tx-live-local-budget-${index}`,
              from: `TLiveLocalBudget${index}1111111111111`,
              to: hopAddress,
              amountRaw: "1",
              at: "2026-07-04T11:59:00.000Z"
            }))
          )
        },
        getLabelsForAddress: async () => [],
        getUsdtRestrictionStatus: async (address: string) => usdtRestrictionProfile({ subjectAddress: address })
      } as any, {
        maxEdgesPerAddress: 2,
        recentFallbackTransferLimit: 2
      });

      expect(handled).toBe(true);
      expect(coverageSnapshot).toMatchObject({
        reachedTargetHop: false,
        coverageComplete: false,
        budgetExhausted: true,
        providerCapHit: false,
        statusReason: "partial_budget_exhausted"
      });
    } finally {
      vi.doUnmock("../../src/check/whereIsMoneyCheck");
      vi.resetModules();
    }
  });

  it("reports balance-forming slice local page budget exhaustion without provider cap", async () => {
    vi.resetModules();
    const hopTimestamp = new Date("2026-07-04T12:00:00.000Z");
    const hopAddress = "THopBalanceSliceBudget111111111111111";
    const targetEdge: ForensicRouteEdge = {
      id: "tx-hop-balance-slice-budget",
      txHash: "tx-hop-balance-slice-budget",
      fromAddress: hopAddress,
      toAddress: subject,
      amountRaw: "100000000",
      timestamp: hopTimestamp,
      method: "transfer",
      edgeType: "normal_transfer"
    };
    let coverageSnapshot: any = null;
    const runWhereIsMoneyCheck = vi.fn(async (deps: any) => {
      await deps.fetchEdgesForAddress(hopAddress, {
        latestTimestamp: hopTimestamp,
        deferBroadTargetedHistory: true,
        targetEdge,
        expectedAmountRaw: targetEdge.amountRaw
      });
      coverageSnapshot = await deps.getHistoryCoverageForAddress(hopAddress, {
        latestTimestamp: hopTimestamp,
        deferBroadTargetedHistory: true,
        targetEdge,
        expectedAmountRaw: targetEdge.amountRaw
      });
      return {
        subjectAddress: subject,
        decision: "REVIEW",
        riskScore: 10,
        coverage: { partial: false, notes: [] },
        originPaths: [],
        balanceFormingTransfers: []
      } as unknown as WhereIsMoneyReport;
    });
    vi.doMock("../../src/check/whereIsMoneyCheck", async (importOriginal) => ({
      ...await importOriginal<typeof import("../../src/check/whereIsMoneyCheck")>(),
      runWhereIsMoneyCheck
    }));

    try {
      const { runSingleDeepForensicJobCycle: runCycleWithMock } = await import("../../src/forensics/deepForensicJob");
      const sourceJob: ForensicCheckJob = {
        ...job(),
        kind: "where_is_money_check",
        windowEnd: new Date("2026-07-05T00:00:00.000Z"),
        progressJson: { mode: "wallet_profile" }
      };
      const listRelatedTrc20Transfers = vi.fn(async (_address: string, options?: { start?: number }) =>
        Array.from({ length: 50 }, (_, index) => transfer({
          id: `tx-budget-noise-${options?.start ?? 0}-${index}`,
          from: `TBudgetNoiseFrom${index.toString().padStart(2, "0")}11111111111`,
          to: `TBudgetNoiseTo${index.toString().padStart(2, "0")}1111111111111`,
          amountRaw: "1",
          at: "2026-07-04T11:59:00.000Z"
        }))
      );

      const handled = await runCycleWithMock({
        claimNextForensicCheckJob: async () => sourceJob,
        completeForensicCheckJob: vi.fn(async () => true),
        releaseForensicCheckJobToWaiting: vi.fn(async () => true),
        updateForensicCheckJobProgress: vi.fn(async () => true),
        recordRiskEvaluation: vi.fn(async () => undefined),
        getAddressUsdtIndexState: vi.fn(async () => null),
        getCoveringAddressUsdtIndexState: vi.fn(async () => null),
        queueAddressUsdtHistory: vi.fn(async () => {
          throw new Error("balance slice should not queue broad targeted history");
        }),
        upsertForensicJobWait: vi.fn(async () => undefined),
        tronClient: { listRelatedTrc20Transfers },
        getLabelsForAddress: async () => [],
        getUsdtRestrictionStatus: async (address: string) => usdtRestrictionProfile({ subjectAddress: address })
      } as any);

      expect(handled).toBe(true);
      expect(listRelatedTrc20Transfers).toHaveBeenCalledTimes(20);
      expect(coverageSnapshot).toMatchObject({
        reachedTargetHop: false,
        coverageComplete: false,
        budgetExhausted: true,
        providerCapHit: false,
        statusReason: "partial_budget_exhausted",
        balanceFormingSlice: expect.objectContaining({
          status: "dense_unresolved",
          reason: "balance_forming_slice_budget_exhausted",
          fetchedPageCount: 20,
          pageBudgetExhausted: true,
          providerCapHit: false
        })
      });
    } finally {
      vi.doUnmock("../../src/check/whereIsMoneyCheck");
      vi.resetModules();
    }
  });

  it("preserves provider-cap metadata from balance-forming slice page fetch", async () => {
    vi.resetModules();
    const hopTimestamp = new Date("2026-07-04T12:00:00.000Z");
    const hopAddress = "THopBalanceSliceProvider111111111111";
    const targetEdge: ForensicRouteEdge = {
      id: "tx-hop-balance-slice-provider",
      txHash: "tx-hop-balance-slice-provider",
      fromAddress: hopAddress,
      toAddress: subject,
      amountRaw: "100000000",
      timestamp: hopTimestamp,
      method: "transfer",
      edgeType: "normal_transfer"
    };
    let coverageSnapshot: any = null;
    const runWhereIsMoneyCheck = vi.fn(async (deps: any) => {
      await deps.fetchEdgesForAddress(hopAddress, {
        latestTimestamp: hopTimestamp,
        deferBroadTargetedHistory: true,
        targetEdge,
        expectedAmountRaw: targetEdge.amountRaw
      });
      coverageSnapshot = await deps.getHistoryCoverageForAddress(hopAddress, {
        latestTimestamp: hopTimestamp,
        deferBroadTargetedHistory: true,
        targetEdge,
        expectedAmountRaw: targetEdge.amountRaw
      });
      return {
        subjectAddress: subject,
        decision: "REVIEW",
        riskScore: 10,
        coverage: { partial: false, notes: [] },
        originPaths: [],
        balanceFormingTransfers: []
      } as unknown as WhereIsMoneyReport;
    });
    vi.doMock("../../src/check/whereIsMoneyCheck", async (importOriginal) => ({
      ...await importOriginal<typeof import("../../src/check/whereIsMoneyCheck")>(),
      runWhereIsMoneyCheck
    }));

    try {
      const { runSingleDeepForensicJobCycle: runCycleWithMock } = await import("../../src/forensics/deepForensicJob");
      const sourceJob: ForensicCheckJob = {
        ...job(),
        kind: "where_is_money_check",
        windowEnd: new Date("2026-07-05T00:00:00.000Z"),
        progressJson: { mode: "wallet_profile" }
      };
      const listRelatedTrc20TransferPage = vi.fn(async (_address: string, options?: { start?: number }) => ({
        transfers: Array.from({ length: 50 }, (_, index) => transfer({
          id: `tx-provider-cap-noise-${options?.start ?? 0}-${index}`,
          from: `TProviderNoiseFrom${index.toString().padStart(2, "0")}1111111`,
          to: `TProviderNoiseTo${index.toString().padStart(2, "0")}111111111`,
          amountRaw: "1",
          at: "2026-07-04T11:59:00.000Z"
        })),
        rangeTotal: 10_000
      }));

      const handled = await runCycleWithMock({
        claimNextForensicCheckJob: async () => sourceJob,
        completeForensicCheckJob: vi.fn(async () => true),
        releaseForensicCheckJobToWaiting: vi.fn(async () => true),
        updateForensicCheckJobProgress: vi.fn(async () => true),
        recordRiskEvaluation: vi.fn(async () => undefined),
        getAddressUsdtIndexState: vi.fn(async () => null),
        getCoveringAddressUsdtIndexState: vi.fn(async () => null),
        queueAddressUsdtHistory: vi.fn(async () => {
          throw new Error("balance slice should not queue broad targeted history");
        }),
        upsertForensicJobWait: vi.fn(async () => undefined),
        tronClient: {
          listRelatedTrc20Transfers: vi.fn(async () => {
            throw new Error("page API should be used when available");
          }),
          listRelatedTrc20TransferPage
        },
        getLabelsForAddress: async () => [],
        getUsdtRestrictionStatus: async (address: string) => usdtRestrictionProfile({ subjectAddress: address })
      } as any);

      expect(handled).toBe(true);
      expect(listRelatedTrc20TransferPage).toHaveBeenCalledTimes(20);
      expect(coverageSnapshot).toMatchObject({
        reachedTargetHop: false,
        coverageComplete: false,
        budgetExhausted: true,
        providerCapHit: true,
        statusReason: "partial_provider_cap",
        balanceFormingSlice: expect.objectContaining({
          status: "dense_unresolved",
          fetchedPageCount: 20,
          pageBudgetExhausted: true,
          providerCapHit: true
        })
      });
    } finally {
      vi.doUnmock("../../src/check/whereIsMoneyCheck");
      vi.resetModules();
    }
  });

  it("keeps where jobs in result flow when broad fallback is terminal after candidate windows", async () => {
    vi.resetModules();
    const hopTimestamp = new Date("2026-07-04T12:00:00.000Z");
    const hopAddress = "THopTerminalBroad11111111111111111111";
    const whereReport = {
      subjectAddress: subject,
      decision: "REVIEW",
      riskScore: 12,
      coverage: {
        partial: true,
        notes: ["terminal broad fallback kept available context"]
      }
    } as unknown as WhereIsMoneyReport;
    const coverageSnapshots: Array<{ reachedTargetHop?: unknown; providerCapHit?: unknown; statusReason?: unknown }> = [];
    const runWhereIsMoneyCheck = vi.fn(async (deps: any) => {
      await deps.fetchEdgesForAddress(hopAddress, {
        latestTimestamp: hopTimestamp,
        deferBroadTargetedHistory: true
      });
      await deps.ensureBroadTargetedHistory({
        address: hopAddress,
        targetTimestamp: hopTimestamp,
        queuedReason: "where_is_money_hop",
        reason: "material_unresolved_after_candidate_windows"
      });
      coverageSnapshots.push(await deps.getHistoryCoverageForAddress(hopAddress, {
        latestTimestamp: hopTimestamp
      }));
      return whereReport;
    });
    vi.doMock("../../src/check/whereIsMoneyCheck", async (importOriginal) => ({
      ...await importOriginal<typeof import("../../src/check/whereIsMoneyCheck")>(),
      runWhereIsMoneyCheck
    }));

    try {
      const { runSingleDeepForensicJobCycle: runCycleWithMock } = await import("../../src/forensics/deepForensicJob");
      const sourceJob: ForensicCheckJob = {
        ...job(),
        kind: "where_is_money_check",
        progressJson: { mode: "wallet_profile" }
      };
      let getStateCall = 0;
      const getAddressUsdtIndexState = vi.fn(async () => {
        getStateCall += 1;
        if (getStateCall === 1) return null;
        return {
          ...queuedIndexState(hopAddress),
          coverageMode: "targeted",
          requestKind: "broad_targeted",
          status: "failed_terminal",
          statusReason: "partial_provider_cap",
          targetTimestamp: hopTimestamp,
          maxAttempts: 8,
          attemptCount: 8,
          lastError: "provider cap"
        } as TronAddressUsdtIndexState;
      });
      const completeForensicCheckJob = vi.fn(async () => true);

      const handled = await runCycleWithMock({
        claimNextForensicCheckJob: async () => sourceJob,
        completeForensicCheckJob,
        releaseForensicCheckJobToWaiting: vi.fn(async () => true),
        updateForensicCheckJobProgress: vi.fn(async () => true),
        recordRiskEvaluation: vi.fn(async () => undefined),
        getAddressUsdtIndexState,
        getCoveringAddressUsdtIndexState: vi.fn(async () => null),
        queueAddressUsdtHistory: vi.fn(async () => {
          throw new Error("terminal broad state should not be requeued");
        }),
        upsertForensicJobWait: vi.fn(async () => undefined),
        tronClient: { listRelatedTrc20Transfers: async () => [] },
        listIndexedUsdtTransfersForAddress: vi.fn(async () => [indexedTransfer({
          txHash: "indexed-terminal-broad",
          fromAddress: "TFunderTerminalBroad111111111111111",
          toAddress: hopAddress,
          amountRaw: "1000000",
          blockTimestamp: new Date("2026-07-04T11:59:30.000Z")
        })]),
        getLabelsForAddress: async () => [],
        getUsdtRestrictionStatus: async (address: string) => usdtRestrictionProfile({ subjectAddress: address })
      } as any);

      expect(handled).toBe(true);
      expect(completeForensicCheckJob).toHaveBeenCalledWith(expect.objectContaining({
        status: "completed",
        lastError: null,
        resultJson: expect.objectContaining({
          whereIsMoneyReport: expect.objectContaining({
            ...whereReport,
            scoringPolicyVersion: SCORING_SIGNAL_MATRIX_POLICY_VERSION
          })
        })
      }));
      expect(coverageSnapshots[0]).toMatchObject({
        reachedTargetHop: false,
        providerCapHit: true,
        statusReason: "partial_provider_cap"
      });
    } finally {
      vi.doUnmock("../../src/check/whereIsMoneyCheck");
      vi.resetModules();
    }
  });

  it("wakes strict benchmark jobs when targeted index completes after waiting release", async () => {
    vi.resetModules();
    const hopTimestamp = new Date("2026-05-20T11:52:00.000Z");
    const hopAddress = "THop111111111111111111111111111111111";
    const runWhereIsMoneyCheck = vi.fn(async (deps: any) => {
      await deps.fetchEdgesForAddress(hopAddress, {
        latestTimestamp: hopTimestamp
      });
      throw new Error("strict wait should abort before scoring");
    });
    vi.doMock("../../src/check/whereIsMoneyCheck", async (importOriginal) => ({
      ...await importOriginal<typeof import("../../src/check/whereIsMoneyCheck")>(),
      runWhereIsMoneyCheck
    }));

    try {
      const { runSingleDeepForensicJobCycle: runCycleWithMock } = await import("../../src/forensics/deepForensicJob");
      const sourceJob: ForensicCheckJob = {
        ...job(),
        kind: "where_is_money_check",
        progressJson: {
          strictProvenanceBenchmark: true,
          mode: "wallet_profile",
          strictProvenance: { phase: "selecting_flows", scoreValid: false, waitingFor: null }
        }
      };
      const getAddressUsdtIndexState = vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockImplementationOnce(async (input: { address: string; targetTimestamp?: Date | null }) => ({
          ...queuedIndexState(input.address),
          coverageMode: "targeted",
          status: "complete",
          statusReason: "complete_provider_windowed",
          targetTimestamp: input.targetTimestamp ?? null,
          requestedByJobId: sourceJob.id
        } as any));
      const queueAddressUsdtHistory = vi.fn(async (input: { address: string; targetTimestamp?: Date | null }) => ({
        ...queuedIndexState(input.address),
        coverageMode: "targeted",
        status: "queued",
        targetTimestamp: input.targetTimestamp ?? null,
        requestedByJobId: sourceJob.id
      } as any));
      const releaseForensicCheckJobToWaiting = vi.fn(async () => true);
      const markWaitingForensicJobsReadyAfterTargetedIndex = vi.fn(async () => 1);
      const completeForensicCheckJob = vi.fn(async () => true);

      const handled = await runCycleWithMock({
        claimNextForensicCheckJob: async () => sourceJob,
        completeForensicCheckJob,
        releaseForensicCheckJobToWaiting,
        markWaitingForensicJobsReadyAfterTargetedIndex,
        updateForensicCheckJobProgress: vi.fn(async () => true),
        recordRiskEvaluation: vi.fn(async () => undefined),
        getAddressUsdtIndexState,
        queueAddressUsdtHistory,
        tronClient: { listRelatedTrc20Transfers: async () => [] },
        getLabelsForAddress: async () => [],
        getUsdtRestrictionStatus: async (address: string) => usdtRestrictionProfile({ subjectAddress: address })
      } as any);

      expect(handled).toBe(true);
      expect(getAddressUsdtIndexState).toHaveBeenCalledTimes(2);
      expect(releaseForensicCheckJobToWaiting).toHaveBeenCalledWith(expect.objectContaining({
        id: sourceJob.id,
        progressJson: expect.objectContaining({
          jobPhase: "waiting_for_targeted_index"
        })
      }));
      expect(markWaitingForensicJobsReadyAfterTargetedIndex).toHaveBeenCalledWith({
        address: hopAddress,
        targetTimestamp: hopTimestamp,
        indexStatus: "complete",
        statusReason: "complete_provider_windowed",
        lastError: null,
        state: expect.objectContaining({
          status: "complete",
          statusReason: "complete_provider_windowed"
        })
      });
      expect(completeForensicCheckJob).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock("../../src/check/whereIsMoneyCheck");
      vi.resetModules();
    }
  });

  it.each([
    ["running", "other-job"],
    ["queued", "other-job"],
    ["queued", null]
  ] as const)(
    "waits strict benchmark jobs when targeted index returns %s owned by %s",
    async (indexStatus, requestedByJobId) => {
      vi.resetModules();
      const hopTimestamp = new Date("2026-05-20T11:52:00.000Z");
      const runWhereIsMoneyCheck = vi.fn(async (deps: any) => {
        await deps.fetchEdgesForAddress("THop111111111111111111111111111111111", {
          latestTimestamp: hopTimestamp
        });
        throw new Error("strict wait should abort before scoring");
      });
      vi.doMock("../../src/check/whereIsMoneyCheck", async (importOriginal) => ({
        ...await importOriginal<typeof import("../../src/check/whereIsMoneyCheck")>(),
        runWhereIsMoneyCheck
      }));

      try {
        const { runSingleDeepForensicJobCycle: runCycleWithMock } = await import("../../src/forensics/deepForensicJob");
        const sourceJob: ForensicCheckJob = {
          ...job(),
          kind: "where_is_money_check",
          progressJson: {
            strictProvenanceBenchmark: true,
            mode: "wallet_profile",
            strictProvenance: { phase: "selecting_flows", scoreValid: false, waitingFor: null }
          }
        };
        const releaseForensicCheckJobToWaiting = vi.fn(async () => true);
        const completeForensicCheckJob = vi.fn(async () => true);
        const upsertForensicJobWait = vi.fn(async () => undefined);
        const queueAddressUsdtHistory = vi.fn(async (input: { address: string; targetTimestamp?: Date | null }) => ({
          ...queuedIndexState(input.address),
          coverageMode: "targeted",
          status: indexStatus,
          targetTimestamp: input.targetTimestamp ?? null,
          requestedByJobId
        } as any));

        const handled = await runCycleWithMock({
          claimNextForensicCheckJob: async () => sourceJob,
          completeForensicCheckJob,
          releaseForensicCheckJobToWaiting,
          updateForensicCheckJobProgress: vi.fn(async () => true),
          recordRiskEvaluation: vi.fn(async () => undefined),
          getAddressUsdtIndexState: vi.fn(async () => null),
          queueAddressUsdtHistory,
          upsertForensicJobWait,
          tronClient: { listRelatedTrc20Transfers: async () => [] },
          getLabelsForAddress: async () => [],
          getUsdtRestrictionStatus: async (address: string) => usdtRestrictionProfile({ subjectAddress: address })
        } as any);

        expect(handled).toBe(true);
        expect(queueAddressUsdtHistory).toHaveBeenCalledWith(expect.objectContaining({
          address: "THop111111111111111111111111111111111",
          coverageMode: "targeted",
          requestedByJobId: sourceJob.id,
          queuedReason: "where_is_money_hop"
        }));
        expect(upsertForensicJobWait).toHaveBeenCalledWith(expect.objectContaining({
          jobId: sourceJob.id,
          address: "THop111111111111111111111111111111111",
          targetTimestamp: hopTimestamp,
          requiredFor: "where_hop"
        }));
        expect(releaseForensicCheckJobToWaiting).toHaveBeenCalledWith(expect.objectContaining({
          id: sourceJob.id,
          progressJson: expect.objectContaining({
            jobPhase: "waiting_for_targeted_index",
            targetedIndex: expect.objectContaining({
              phase: "waiting_for_targeted_index"
            }),
            strictProvenance: expect.objectContaining({
              phase: "waiting_for_targeted_index",
              scoreValid: false
            })
          })
        }));
        expect(completeForensicCheckJob).not.toHaveBeenCalled();
      } finally {
        vi.doUnmock("../../src/check/whereIsMoneyCheck");
        vi.resetModules();
      }
    }
  );

  it("continues strict benchmark jobs when targeted index is already complete", async () => {
    vi.resetModules();
    const hopTimestamp = new Date("2026-05-20T11:52:00.000Z");
    const runWhereIsMoneyCheck = vi.fn(async (deps: any) => {
      await deps.fetchEdgesForAddress("THop111111111111111111111111111111111", {
        latestTimestamp: hopTimestamp
      });
      return {
        subjectAddress: subject,
        decision: "ACCEPTABLE",
        riskScore: 20,
        coverage: { partial: false, notes: [] },
        originPaths: [],
        balanceFormingTransfers: []
      };
    });
    vi.doMock("../../src/check/whereIsMoneyCheck", async (importOriginal) => ({
      ...await importOriginal<typeof import("../../src/check/whereIsMoneyCheck")>(),
      runWhereIsMoneyCheck
    }));

    try {
      const { runSingleDeepForensicJobCycle: runCycleWithMock } = await import("../../src/forensics/deepForensicJob");
      const sourceJob: ForensicCheckJob = {
        ...job(),
        kind: "where_is_money_check",
        progressJson: {
          strictProvenanceBenchmark: true,
          mode: "wallet_profile",
          strictProvenance: { phase: "selecting_flows", scoreValid: false, waitingFor: null }
        }
      };
      const getAddressUsdtIndexState = vi.fn(async (input: { address: string; targetTimestamp?: Date | null }) => ({
        ...queuedIndexState(input.address),
        coverageMode: "targeted",
        status: "complete",
        statusReason: "complete_provider_windowed",
        targetTimestamp: input.targetTimestamp ?? null
      } as any));
      const queueAddressUsdtHistory = vi.fn(async () => queuedIndexState("THop111111111111111111111111111111111"));
      const releaseForensicCheckJobToWaiting = vi.fn(async () => true);
      const completeForensicCheckJob = vi.fn(async () => true);

      const handled = await runCycleWithMock({
        claimNextForensicCheckJob: async () => sourceJob,
        completeForensicCheckJob,
        releaseForensicCheckJobToWaiting,
        updateForensicCheckJobProgress: vi.fn(async () => true),
        recordRiskEvaluation: vi.fn(async () => undefined),
        getAddressUsdtIndexState,
        queueAddressUsdtHistory,
        tronClient: { listRelatedTrc20Transfers: async () => [] },
        getLabelsForAddress: async () => [],
        getUsdtRestrictionStatus: async (address: string) => usdtRestrictionProfile({ subjectAddress: address })
      } as any);

      expect(handled).toBe(true);
      expect(runWhereIsMoneyCheck).toHaveBeenCalled();
      expect(getAddressUsdtIndexState).toHaveBeenCalledWith(expect.objectContaining({
        address: "THop111111111111111111111111111111111",
        coverageMode: "targeted",
        targetTimestamp: hopTimestamp
      }));
      expect(queueAddressUsdtHistory).not.toHaveBeenCalled();
      expect(releaseForensicCheckJobToWaiting).not.toHaveBeenCalled();
      expect(completeForensicCheckJob).toHaveBeenCalledWith(expect.objectContaining({
        id: sourceJob.id,
        status: "completed"
      }));
    } finally {
      vi.doUnmock("../../src/check/whereIsMoneyCheck");
      vi.resetModules();
    }
  });

  it("stores valid score fields when strict benchmark completes", async () => {
    vi.resetModules();
    const whereReport = {
      subjectAddress: subject,
      decision: "ACCEPTABLE",
      riskScore: 20,
      coverage: { partial: false, notes: [] },
      originPaths: [],
      balanceFormingTransfers: []
    };
    const runWhereIsMoneyCheck = vi.fn(async (_deps: unknown, options: { onProgress?: (patch: Record<string, unknown>) => Promise<void> }) => {
      await options.onProgress?.({ crossChainStage2Progress: { checked: 2 } });
      return whereReport;
    });
    vi.doMock("../../src/check/whereIsMoneyCheck", async (importOriginal) => ({
      ...await importOriginal<typeof import("../../src/check/whereIsMoneyCheck")>(),
      runWhereIsMoneyCheck
    }));

    try {
      const { runSingleDeepForensicJobCycle: runCycleWithMock } = await import("../../src/forensics/deepForensicJob");
      const sourceJob: ForensicCheckJob = {
        ...job(),
        kind: "where_is_money_check",
        progressJson: {
          strictProvenanceBenchmark: true,
          mode: "wallet_profile",
          strictProvenance: { phase: "scoring", scoreValid: false, waitingFor: null }
        }
      };
      const completeForensicCheckJob = vi.fn(async (_input: Parameters<Parameters<typeof runSingleDeepForensicJobCycle>[0]["completeForensicCheckJob"]>[0]) => true);

      const handled = await runCycleWithMock({
        claimNextForensicCheckJob: async () => sourceJob,
        completeForensicCheckJob,
        recordRiskEvaluation: vi.fn(async () => undefined),
        tronClient: { listRelatedTrc20Transfers: async () => [] },
        getLabelsForAddress: async () => [],
        getUsdtRestrictionStatus: async (address: string) => usdtRestrictionProfile({ subjectAddress: address })
      } as any);

      expect(handled).toBe(true);
      expect(completeForensicCheckJob).toHaveBeenCalledWith(expect.objectContaining({
        status: "completed",
        progressJson: expect.objectContaining({
          strictProvenance: expect.objectContaining({
            phase: "completed",
            scoreValid: true,
            scoreBlockedReason: null,
            technicalStatus: "completed",
            waitingFor: null
          })
        }),
        resultJson: expect.objectContaining({
          score_valid: true,
          score_blocked_reason: null,
          technical_status: "completed"
        })
      }));
      const progressJson = completeForensicCheckJob.mock.calls[0][0].progressJson as Record<string, any>;
      expect(progressJson.strictBenchmarkMetrics.stages).toEqual(expect.objectContaining({
        traceMs: expect.any(Number),
        scoringMs: expect.any(Number)
      }));
      expect(progressJson.crossChainStage2Progress).toEqual(expect.objectContaining({ checked: 2 }));
    } finally {
      vi.doUnmock("../../src/check/whereIsMoneyCheck");
      vi.resetModules();
    }
  });

  it("blocks strict benchmark score fields when cross-chain corridor data is partial", async () => {
    vi.resetModules();
    const whereReport = {
      subjectAddress: subject,
      decision: "REVIEW",
      riskScore: 55,
      coverage: { partial: false, notes: [] },
      originPaths: [],
      balanceFormingTransfers: [],
      crossChainCorridor: { partial: true }
    };
    const runWhereIsMoneyCheck = vi.fn(async () => whereReport);
    vi.doMock("../../src/check/whereIsMoneyCheck", async (importOriginal) => ({
      ...await importOriginal<typeof import("../../src/check/whereIsMoneyCheck")>(),
      runWhereIsMoneyCheck
    }));

    try {
      const { runSingleDeepForensicJobCycle: runCycleWithMock } = await import("../../src/forensics/deepForensicJob");
      const sourceJob: ForensicCheckJob = {
        ...job(),
        kind: "where_is_money_check",
        progressJson: {
          strictProvenanceBenchmark: true,
          mode: "wallet_profile",
          strictProvenance: { phase: "scoring", scoreValid: false, waitingFor: null }
        }
      };
      const completeForensicCheckJob = vi.fn(async (_input: Parameters<Parameters<typeof runSingleDeepForensicJobCycle>[0]["completeForensicCheckJob"]>[0]) => true);

      const handled = await runCycleWithMock({
        claimNextForensicCheckJob: async () => sourceJob,
        completeForensicCheckJob,
        recordRiskEvaluation: vi.fn(async () => undefined),
        tronClient: { listRelatedTrc20Transfers: async () => [] },
        getLabelsForAddress: async () => [],
        getUsdtRestrictionStatus: async (address: string) => usdtRestrictionProfile({ subjectAddress: address })
      } as any);

      expect(handled).toBe(true);
      const completion = completeForensicCheckJob.mock.calls[0]?.[0];
      if (!completion) throw new Error("expected strict partial job completion");
      expect(completion).toMatchObject({
        status: "failed",
        rawEvidenceIds: [],
        observationIds: [],
        lastError: "provider_error",
        progressJson: expect.objectContaining({
          strictProvenance: expect.objectContaining({
            phase: "provider_limited",
            scoreValid: false,
            scoreBlockedReason: "provider_error",
            technicalStatus: "provider_error",
            waitingFor: null
          })
        }),
        resultJson: expect.objectContaining({
          subjectAddress: subject,
          whereIsMoneyReport: expect.objectContaining({
            ...whereReport,
            scoringPolicyVersion: SCORING_SIGNAL_MATRIX_POLICY_VERSION
          }),
          score_valid: false,
          score_blocked_reason: "provider_error",
          technical_status: "provider_error"
        })
      });
      expect(completion.resultJson).not.toMatchObject({ score_valid: true });
    } finally {
      vi.doUnmock("../../src/check/whereIsMoneyCheck");
      vi.resetModules();
    }
  });

  it("blocks strict benchmark score fields when where-is-money coverage is partial", async () => {
    vi.resetModules();
    const whereReport = {
      subjectAddress: subject,
      decision: "REVIEW",
      riskScore: 55,
      coverage: { partial: true, notes: [] },
      originPaths: [],
      balanceFormingTransfers: []
    };
    const runWhereIsMoneyCheck = vi.fn(async () => whereReport);
    vi.doMock("../../src/check/whereIsMoneyCheck", async (importOriginal) => ({
      ...await importOriginal<typeof import("../../src/check/whereIsMoneyCheck")>(),
      runWhereIsMoneyCheck
    }));

    try {
      const { runSingleDeepForensicJobCycle: runCycleWithMock } = await import("../../src/forensics/deepForensicJob");
      const sourceJob: ForensicCheckJob = {
        ...job(),
        kind: "where_is_money_check",
        progressJson: {
          strictProvenanceBenchmark: true,
          mode: "wallet_profile",
          strictProvenance: { phase: "scoring", scoreValid: false, waitingFor: null }
        }
      };
      const completeForensicCheckJob = vi.fn(async (_input: Parameters<Parameters<typeof runSingleDeepForensicJobCycle>[0]["completeForensicCheckJob"]>[0]) => true);

      const handled = await runCycleWithMock({
        claimNextForensicCheckJob: async () => sourceJob,
        completeForensicCheckJob,
        recordRiskEvaluation: vi.fn(async () => undefined),
        tronClient: { listRelatedTrc20Transfers: async () => [] },
        getLabelsForAddress: async () => [],
        getUsdtRestrictionStatus: async (address: string) => usdtRestrictionProfile({ subjectAddress: address })
      } as any);

      expect(handled).toBe(true);
      const completion = completeForensicCheckJob.mock.calls[0]?.[0];
      if (!completion) throw new Error("expected strict partial coverage job completion");
      expect(completion).toMatchObject({
        status: "failed",
        rawEvidenceIds: [],
        observationIds: [],
        lastError: "provider_error",
        progressJson: expect.objectContaining({
          strictProvenance: expect.objectContaining({
            phase: "provider_limited",
            scoreValid: false,
            scoreBlockedReason: "provider_error",
            technicalStatus: "provider_error",
            waitingFor: null
          })
        }),
        resultJson: expect.objectContaining({
          subjectAddress: subject,
          whereIsMoneyReport: expect.objectContaining({
            ...whereReport,
            scoringPolicyVersion: SCORING_SIGNAL_MATRIX_POLICY_VERSION
          }),
          score_valid: false,
          score_blocked_reason: "provider_error",
          technical_status: "provider_error"
        })
      });
      expect(completion.resultJson).not.toMatchObject({ score_valid: true });
    } finally {
      vi.doUnmock("../../src/check/whereIsMoneyCheck");
      vi.resetModules();
    }
  });

  it("stores blocked score fields when resumed strict benchmark is provider-limited", async () => {
    vi.resetModules();
    const runWhereIsMoneyCheck = vi.fn(async () => {
      throw new Error("provider-limited jobs should complete before tracing");
    });
    vi.doMock("../../src/check/whereIsMoneyCheck", async (importOriginal) => ({
      ...await importOriginal<typeof import("../../src/check/whereIsMoneyCheck")>(),
      runWhereIsMoneyCheck
    }));

    try {
      const { runSingleDeepForensicJobCycle: runCycleWithMock } = await import("../../src/forensics/deepForensicJob");
      const sourceJob: ForensicCheckJob = {
        ...job(),
        kind: "where_is_money_check",
        progressJson: {
          strictProvenanceBenchmark: true,
          jobPhase: "provider_limited",
          mode: "wallet_profile",
          strictProvenance: {
            phase: "provider_limited",
            scoreValid: false,
            scoreBlockedReason: "rate_limited_after_retries",
            waitingFor: null
          }
        }
      };
      const completeForensicCheckJob = vi.fn(async () => true);

      const handled = await runCycleWithMock({
        claimNextForensicCheckJob: async () => sourceJob,
        completeForensicCheckJob,
        recordRiskEvaluation: vi.fn(async () => undefined),
        tronClient: { listRelatedTrc20Transfers: async () => [] },
        getLabelsForAddress: async () => [],
        getUsdtRestrictionStatus: async (address: string) => usdtRestrictionProfile({ subjectAddress: address })
      } as any);

      expect(handled).toBe(true);
      expect(runWhereIsMoneyCheck).not.toHaveBeenCalled();
      expect(completeForensicCheckJob).toHaveBeenCalledWith(expect.objectContaining({
        status: "failed",
        rawEvidenceIds: [],
        observationIds: [],
        lastError: "rate_limited_after_retries",
        resultJson: expect.objectContaining({
          scoringPolicyVersion: SCORING_SIGNAL_MATRIX_POLICY_VERSION,
          subjectAddress: subject,
          score_valid: false,
          score_blocked_reason: "rate_limited_after_retries",
          technical_status: "provider_limited"
        })
      }));
    } finally {
      vi.doUnmock("../../src/check/whereIsMoneyCheck");
      vi.resetModules();
    }
  });

  it.each(["partial", "failed_terminal"] as const)(
    "fails strict benchmark jobs when existing targeted index is %s",
    async (indexStatus) => {
      vi.resetModules();
      const hopTimestamp = new Date("2026-05-20T11:52:00.000Z");
      const runWhereIsMoneyCheck = vi.fn(async (deps: any) => {
        await deps.fetchEdgesForAddress("THop111111111111111111111111111111111", {
          latestTimestamp: hopTimestamp
        });
        throw new Error("strict terminal index should abort before scoring");
      });
      vi.doMock("../../src/check/whereIsMoneyCheck", async (importOriginal) => ({
        ...await importOriginal<typeof import("../../src/check/whereIsMoneyCheck")>(),
        runWhereIsMoneyCheck
      }));

      try {
        const { runSingleDeepForensicJobCycle: runCycleWithMock } = await import("../../src/forensics/deepForensicJob");
        const sourceJob: ForensicCheckJob = {
          ...job(),
          kind: "where_is_money_check",
          progressJson: {
            strictProvenanceBenchmark: true,
            mode: "wallet_profile",
            strictProvenance: { phase: "selecting_flows", scoreValid: false, waitingFor: null }
          }
        };
        const getAddressUsdtIndexState = vi.fn(async (input: { address: string; targetTimestamp?: Date | null }) => ({
          ...queuedIndexState(input.address),
          coverageMode: "targeted",
          status: indexStatus,
          statusReason: indexStatus === "partial" ? "partial_provider_cap" : "failed_terminal",
          targetTimestamp: input.targetTimestamp ?? null
        } as any));
        const queueAddressUsdtHistory = vi.fn(async (input: { address: string; targetTimestamp?: Date | null }) => ({
          ...queuedIndexState(input.address),
          coverageMode: "targeted",
          status: "queued",
          targetTimestamp: input.targetTimestamp ?? null,
          requestedByJobId: sourceJob.id,
          queuedReason: "where_is_money_hop"
        } as any));
        const releaseForensicCheckJobToWaiting = vi.fn(async () => true);
        const completeForensicCheckJob = vi.fn(async () => true);
        const upsertForensicJobWait = vi.fn(async () => undefined);

        const handled = await runCycleWithMock({
          claimNextForensicCheckJob: async () => sourceJob,
          completeForensicCheckJob,
          releaseForensicCheckJobToWaiting,
          updateForensicCheckJobProgress: vi.fn(async () => true),
          recordRiskEvaluation: vi.fn(async () => undefined),
          getAddressUsdtIndexState,
          queueAddressUsdtHistory,
          upsertForensicJobWait,
          tronClient: { listRelatedTrc20Transfers: async () => [] },
          getLabelsForAddress: async () => [],
          getUsdtRestrictionStatus: async (address: string) => usdtRestrictionProfile({ subjectAddress: address })
        } as any);

        expect(handled).toBe(true);
        expect(getAddressUsdtIndexState).toHaveBeenCalledWith(expect.objectContaining({
          address: "THop111111111111111111111111111111111",
          coverageMode: "targeted",
          targetTimestamp: hopTimestamp
        }));
        if (indexStatus === "partial") {
          expect(queueAddressUsdtHistory).toHaveBeenCalledWith(expect.objectContaining({
            address: "THop111111111111111111111111111111111",
            coverageMode: "targeted",
            targetTimestamp: hopTimestamp,
            requestedByJobId: sourceJob.id,
            queuedReason: "where_is_money_hop"
          }));
          expect(upsertForensicJobWait).toHaveBeenCalledWith(expect.objectContaining({
            jobId: sourceJob.id,
            address: "THop111111111111111111111111111111111",
            targetTimestamp: hopTimestamp,
            requiredFor: "where_hop"
          }));
          expect(releaseForensicCheckJobToWaiting).toHaveBeenCalledWith(expect.objectContaining({
            id: sourceJob.id,
            progressJson: expect.objectContaining({
              jobPhase: "waiting_for_targeted_index",
              targetedIndex: expect.objectContaining({
                lastIndexStatus: "queued",
                statusReason: null
              })
            })
          }));
          expect(completeForensicCheckJob).not.toHaveBeenCalled();
          return;
        }
        expect(queueAddressUsdtHistory).not.toHaveBeenCalled();
        expect(releaseForensicCheckJobToWaiting).not.toHaveBeenCalled();
        const blockedReason = "provider_error";
        const technicalStatus = "provider_error";
        expect(completeForensicCheckJob).toHaveBeenCalledWith(expect.objectContaining({
          id: sourceJob.id,
          status: "failed",
          lastError: `strict_provenance_targeted_index_terminal:${indexStatus}`,
          progressJson: expect.objectContaining({
            jobPhase: "provider_limited",
            strictProvenance: expect.objectContaining({
              phase: "provider_limited",
              scoreValid: false,
              scoreBlockedReason: blockedReason,
              technicalStatus,
              waitingFor: null
            }),
            strictBenchmarkMetrics: expect.objectContaining({
              stages: expect.objectContaining({ traceMs: expect.any(Number) })
            })
          }),
          resultJson: expect.objectContaining({
            subjectAddress: subject,
            score_valid: false,
            score_blocked_reason: blockedReason,
            technical_status: technicalStatus
          })
        }));
      } finally {
        vi.doUnmock("../../src/check/whereIsMoneyCheck");
        vi.resetModules();
      }
    }
  );

  it("continues strict benchmark jobs when queued targeted index completes immediately", async () => {
    vi.resetModules();
    const hopTimestamp = new Date("2026-05-20T11:52:00.000Z");
    const runWhereIsMoneyCheck = vi.fn(async (deps: any) => {
      await deps.fetchEdgesForAddress("THop111111111111111111111111111111111", {
        latestTimestamp: hopTimestamp
      });
      return {
        subjectAddress: subject,
        decision: "ACCEPTABLE",
        riskScore: 20,
        coverage: { partial: false, notes: [] },
        originPaths: [],
        balanceFormingTransfers: []
      };
    });
    vi.doMock("../../src/check/whereIsMoneyCheck", async (importOriginal) => ({
      ...await importOriginal<typeof import("../../src/check/whereIsMoneyCheck")>(),
      runWhereIsMoneyCheck
    }));

    try {
      const { runSingleDeepForensicJobCycle: runCycleWithMock } = await import("../../src/forensics/deepForensicJob");
      const sourceJob: ForensicCheckJob = {
        ...job(),
        kind: "where_is_money_check",
        progressJson: {
          strictProvenanceBenchmark: true,
          mode: "wallet_profile",
          strictProvenance: { phase: "selecting_flows", scoreValid: false, waitingFor: null }
        }
      };
      const getAddressUsdtIndexState = vi.fn(async () => null);
      const queueAddressUsdtHistory = vi.fn(async (input: { address: string; targetTimestamp?: Date | null }) => ({
        ...queuedIndexState(input.address),
        coverageMode: "targeted",
        status: "complete",
        statusReason: "complete_provider_windowed",
        targetTimestamp: input.targetTimestamp ?? null
      } as any));
      const releaseForensicCheckJobToWaiting = vi.fn(async () => true);
      const completeForensicCheckJob = vi.fn(async () => true);

      const handled = await runCycleWithMock({
        claimNextForensicCheckJob: async () => sourceJob,
        completeForensicCheckJob,
        releaseForensicCheckJobToWaiting,
        updateForensicCheckJobProgress: vi.fn(async () => true),
        recordRiskEvaluation: vi.fn(async () => undefined),
        getAddressUsdtIndexState,
        queueAddressUsdtHistory,
        tronClient: { listRelatedTrc20Transfers: async () => [] },
        getLabelsForAddress: async () => [],
        getUsdtRestrictionStatus: async (address: string) => usdtRestrictionProfile({ subjectAddress: address })
      } as any);

      expect(handled).toBe(true);
      expect(queueAddressUsdtHistory).toHaveBeenCalledWith(expect.objectContaining({
        address: "THop111111111111111111111111111111111",
        coverageMode: "targeted",
        requestedByJobId: sourceJob.id,
        queuedReason: "where_is_money_hop"
      }));
      expect(releaseForensicCheckJobToWaiting).not.toHaveBeenCalled();
      expect(completeForensicCheckJob).toHaveBeenCalledWith(expect.objectContaining({
        id: sourceJob.id,
        status: "completed",
        lastError: null
      }));
      expect(completeForensicCheckJob).toHaveBeenCalledTimes(1);
    } finally {
      vi.doUnmock("../../src/check/whereIsMoneyCheck");
      vi.resetModules();
    }
  });

  it.each(["failed_terminal", "partial"] as const)(
    "fails strict benchmark jobs when queued targeted index returns %s",
    async (indexStatus) => {
      vi.resetModules();
      const hopTimestamp = new Date("2026-05-20T11:52:00.000Z");
      const runWhereIsMoneyCheck = vi.fn(async (deps: any) => {
        await deps.fetchEdgesForAddress("THop111111111111111111111111111111111", {
          latestTimestamp: hopTimestamp
        });
        throw new Error("strict terminal index should abort before scoring");
      });
      vi.doMock("../../src/check/whereIsMoneyCheck", async (importOriginal) => ({
        ...await importOriginal<typeof import("../../src/check/whereIsMoneyCheck")>(),
        runWhereIsMoneyCheck
      }));

      try {
        const { runSingleDeepForensicJobCycle: runCycleWithMock } = await import("../../src/forensics/deepForensicJob");
        const sourceJob: ForensicCheckJob = {
          ...job(),
          kind: "where_is_money_check",
          progressJson: {
            strictProvenanceBenchmark: true,
            mode: "wallet_profile",
            strictProvenance: { phase: "selecting_flows", scoreValid: false, waitingFor: null }
          }
        };
        const releaseForensicCheckJobToWaiting = vi.fn(async () => true);
        const completeForensicCheckJob = vi.fn(async () => true);
        const upsertForensicJobWait = vi.fn(async () => undefined);

        const handled = await runCycleWithMock({
          claimNextForensicCheckJob: async () => sourceJob,
          completeForensicCheckJob,
          releaseForensicCheckJobToWaiting,
          updateForensicCheckJobProgress: vi.fn(async () => true),
          recordRiskEvaluation: vi.fn(async () => undefined),
          getAddressUsdtIndexState: vi.fn(async () => null),
          queueAddressUsdtHistory: vi.fn(async (input: { address: string; targetTimestamp?: Date | null }) => ({
            ...queuedIndexState(input.address),
            coverageMode: "targeted",
            status: indexStatus,
            statusReason: indexStatus === "partial" ? "partial_provider_cap" : "failed_terminal",
            targetTimestamp: input.targetTimestamp ?? null
          } as any)),
          upsertForensicJobWait,
          tronClient: { listRelatedTrc20Transfers: async () => [] },
          getLabelsForAddress: async () => [],
          getUsdtRestrictionStatus: async (address: string) => usdtRestrictionProfile({ subjectAddress: address })
        } as any);

        expect(handled).toBe(true);
        if (indexStatus === "partial") {
          expect(releaseForensicCheckJobToWaiting).toHaveBeenCalledWith(expect.objectContaining({
            id: sourceJob.id,
            progressJson: expect.objectContaining({
              jobPhase: "waiting_for_targeted_index",
              targetedIndex: expect.objectContaining({
                lastIndexStatus: "partial",
                statusReason: "partial_provider_cap"
              })
            })
          }));
          expect(upsertForensicJobWait).toHaveBeenCalledWith(expect.objectContaining({
            jobId: sourceJob.id,
            requiredFor: "where_hop"
          }));
          expect(completeForensicCheckJob).not.toHaveBeenCalled();
          return;
        }
        expect(releaseForensicCheckJobToWaiting).not.toHaveBeenCalled();
        const blockedReason = "provider_error";
        const technicalStatus = "provider_error";
        expect(completeForensicCheckJob).toHaveBeenCalledWith(expect.objectContaining({
          id: sourceJob.id,
          status: "failed",
          lastError: `strict_provenance_targeted_index_terminal:${indexStatus}`,
          progressJson: expect.objectContaining({
            jobPhase: "provider_limited",
            strictProvenance: expect.objectContaining({
              phase: "provider_limited",
              scoreValid: false,
              scoreBlockedReason: blockedReason,
              technicalStatus,
              waitingFor: null
            }),
            strictBenchmarkMetrics: expect.objectContaining({
              stages: expect.objectContaining({ traceMs: expect.any(Number) })
            })
          }),
          resultJson: expect.objectContaining({
            subjectAddress: subject,
            score_valid: false,
            score_blocked_reason: blockedReason,
            technical_status: technicalStatus
          })
        }));
      } finally {
        vi.doUnmock("../../src/check/whereIsMoneyCheck");
        vi.resetModules();
      }
    }
  );

  it("fails strict benchmark jobs when waiting release does not update the job", async () => {
    vi.resetModules();
    const hopTimestamp = new Date("2026-05-20T11:52:00.000Z");
    const runWhereIsMoneyCheck = vi.fn(async (deps: any) => {
      await deps.fetchEdgesForAddress("THop111111111111111111111111111111111", {
        latestTimestamp: hopTimestamp
      });
      throw new Error("strict wait should abort before scoring");
    });
    vi.doMock("../../src/check/whereIsMoneyCheck", async (importOriginal) => ({
      ...await importOriginal<typeof import("../../src/check/whereIsMoneyCheck")>(),
      runWhereIsMoneyCheck
    }));

    try {
      const { runSingleDeepForensicJobCycle: runCycleWithMock } = await import("../../src/forensics/deepForensicJob");
      const sourceJob: ForensicCheckJob = {
        ...job(),
        kind: "where_is_money_check",
        progressJson: {
          strictProvenanceBenchmark: true,
          mode: "wallet_profile",
          strictProvenance: { phase: "selecting_flows", scoreValid: false, waitingFor: null }
        }
      };
      const completeForensicCheckJob = vi.fn(async () => true);

      const handled = await runCycleWithMock({
        claimNextForensicCheckJob: async () => sourceJob,
        completeForensicCheckJob,
        releaseForensicCheckJobToWaiting: vi.fn(async () => false),
        updateForensicCheckJobProgress: vi.fn(async () => true),
        recordRiskEvaluation: vi.fn(async () => undefined),
        getAddressUsdtIndexState: vi.fn(async () => null),
        queueAddressUsdtHistory: vi.fn(async () => queuedIndexState("THop111111111111111111111111111111111")),
        tronClient: { listRelatedTrc20Transfers: async () => [] },
        getLabelsForAddress: async () => [],
        getUsdtRestrictionStatus: async (address: string) => usdtRestrictionProfile({ subjectAddress: address })
      } as any);

      expect(handled).toBe(true);
      expect(completeForensicCheckJob).toHaveBeenCalledWith(expect.objectContaining({
        id: sourceJob.id,
        status: "failed",
        lastError: "strict_provenance_wait_release_failed",
        progressJson: expect.objectContaining({
          jobPhase: "provider_limited",
          strictProvenance: expect.objectContaining({
            phase: "provider_limited",
            scoreValid: false,
            scoreBlockedReason: "provider_error",
            technicalStatus: "provider_error",
            waitingFor: null
          }),
          strictBenchmarkMetrics: expect.objectContaining({
            stages: expect.objectContaining({ traceMs: expect.any(Number) })
          })
        }),
        resultJson: expect.objectContaining({
          subjectAddress: subject,
          score_valid: false,
          score_blocked_reason: "provider_error",
          technical_status: "provider_error"
        })
      }));
    } finally {
      vi.doUnmock("../../src/check/whereIsMoneyCheck");
      vi.resetModules();
    }
  });

  it("keeps normal where-is-money targeted ensure synchronous", async () => {
    vi.resetModules();
    const runWhereIsMoneyCheck = vi.fn(async (deps: any) => {
      await deps.fetchEdgesForAddress("THop111111111111111111111111111111111", {
        latestTimestamp: new Date("2026-06-30T11:52:00.000Z")
      });
      return {
        subjectAddress: subject,
        decision: "ACCEPTABLE",
        riskScore: 20,
        coverage: { partial: false, notes: [] },
        originPaths: [],
        balanceFormingTransfers: []
      };
    });
    vi.doMock("../../src/check/whereIsMoneyCheck", async (importOriginal) => ({
      ...await importOriginal<typeof import("../../src/check/whereIsMoneyCheck")>(),
      runWhereIsMoneyCheck
    }));

    try {
      const { runSingleDeepForensicJobCycle: runCycleWithMock } = await import("../../src/forensics/deepForensicJob");
      const ensureAddressUsdtHistory = vi.fn(async () => ({
        coverageMode: "targeted",
        status: "complete",
        statusReason: "complete_provider_windowed"
      } as any));
      const completeForensicCheckJob = vi.fn(async () => true);

      await runCycleWithMock({
        claimNextForensicCheckJob: async () => ({
          ...job(),
          kind: "where_is_money_check",
          progressJson: { mode: "wallet_profile" }
        }),
        completeForensicCheckJob,
        updateForensicCheckJobProgress: vi.fn(async () => true),
        recordRiskEvaluation: vi.fn(async () => undefined),
        ensureAddressUsdtHistory,
        tronClient: { listRelatedTrc20Transfers: async () => [] },
        getLabelsForAddress: async () => [],
        getUsdtRestrictionStatus: async (address: string) => usdtRestrictionProfile({ subjectAddress: address })
      } as any);

      expect(ensureAddressUsdtHistory).toHaveBeenCalled();
      expect(completeForensicCheckJob).toHaveBeenCalled();
    } finally {
      vi.doUnmock("../../src/check/whereIsMoneyCheck");
      vi.resetModules();
    }
  });

  it("does not target-index the initial where-is-money subject window fetch", async () => {
    const sourceJob: ForensicCheckJob = {
      ...job(),
      kind: "where_is_money_check",
      priority: 120,
      progressJson: { fastRiskSnapshot: { score: 0, level: "LOW" }, locale: "en" }
    };
    const ensureAddressUsdtHistory = vi.fn(async (input: Parameters<NonNullable<Parameters<typeof runSingleDeepForensicJobCycle>[0]["ensureAddressUsdtHistory"]>>[0]) => ({
      ...queuedIndexState(input.address),
      coverageMode: input.coverageMode,
      targetTimestamp: input.targetTimestamp ?? null,
      stopAtTimestamp: input.stopAtTimestamp ?? null,
      queuedReason: input.queuedReason,
      requestedByJobId: input.requestedByJobId ?? null
    }));
    const indexedAddresses: string[] = [];

    const handled = await runSingleDeepForensicJobCycle({
      claimNextForensicCheckJob: async () => sourceJob,
      completeForensicCheckJob: vi.fn(async () => true),
      recordRiskEvaluation: vi.fn(async () => undefined),
      ensureAddressUsdtHistory,
      listIndexedUsdtTransfersForAddress: async (address) => {
        indexedAddresses.push(address);
        return [];
      },
      tronClient: {
        listRelatedTrc20Transfers: async () => []
      },
      getLabelsForAddress: async () => [],
      getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({
        subjectAddress: address,
        balanceRaw: address === subject ? "1000000" : null
      })
    }, {
      recentFallbackMinTransferCount: 60,
      maxEdgesPerAddress: 60,
      recentFallbackTransferLimit: 60
    });

    expect(handled).toBe(true);
    expect(indexedAddresses).toContain(subject);
    expect(ensureAddressUsdtHistory).not.toHaveBeenCalled();
  });

  it("uses cached targeted transfers when targeted state is terminal provider cap", async () => {
    vi.resetModules();
    const hopAddress = "THop111111111111111111111111111111111";
    const hopTimestamp = new Date("2026-05-20T11:52:00.000Z");
    const runWhereIsMoneyCheck = vi.fn(async (deps: any) => {
      const edges = await deps.fetchEdgesForAddress(hopAddress, { latestTimestamp: hopTimestamp });
      const coverage = await deps.getHistoryCoverageForAddress(hopAddress, { latestTimestamp: hopTimestamp });
      return {
        subjectAddress: subject,
        decision: "REVIEW",
        riskScore: 45,
        coverage: { partial: false, notes: [] },
        originPaths: [{
          balanceTransferTxHash: "tx-hop-subject",
          rootSourceAddress: hopAddress,
          rootSourceType: "incomplete",
          pathAddresses: [hopAddress, subject],
          txHashes: ["tx-hop-subject"],
          steps: [],
          historyCoverage: [coverage],
          stoppedReason: "incoming_history_not_fetched",
          verdict: "REVIEW",
          riskScoreContribution: 45,
          amountPreservationRatio: 1,
          timeSpanMs: null,
          reasons: [`cached_edges:${edges.length}`]
        }],
        balanceFormingTransfers: []
      };
    });
    vi.doMock("../../src/check/whereIsMoneyCheck", async (importOriginal) => ({
      ...await importOriginal<typeof import("../../src/check/whereIsMoneyCheck")>(),
      runWhereIsMoneyCheck
    }));

    try {
      const { runSingleDeepForensicJobCycle: runCycleWithMock } = await import("../../src/forensics/deepForensicJob");
      const sourceJob: ForensicCheckJob = {
        ...job(),
        kind: "where_is_money_check",
        progressJson: { mode: "wallet_profile" }
      };
      const getAddressUsdtIndexState = vi.fn(async (input: { address: string; targetTimestamp?: Date | null }) => ({
        ...queuedIndexState(input.address),
        coverageMode: "targeted",
        status: "partial",
        statusReason: "partial_provider_cap",
        targetTimestamp: input.targetTimestamp ?? null,
        providerCapHit: true,
        budgetExhausted: false,
        attemptCount: 12,
        maxAttempts: 8,
        budgetPages: 12000,
        fetchedPageCount: 12000,
        fetchedTransferCount: 42000
      } as any));
      const queueAddressUsdtHistory = vi.fn(async () => {
        throw new Error("terminal targeted state must not requeue during cache analysis");
      });
      const releaseForensicCheckJobToWaiting = vi.fn(async () => true);
      const completeForensicCheckJob = vi.fn(async (_input: Parameters<Parameters<typeof runSingleDeepForensicJobCycle>[0]["completeForensicCheckJob"]>[0]) => true);
      const indexedLookup = vi.fn(async (address: string) => {
        if (address !== hopAddress) return [];
        return [indexedTransfer({
          txHash: "tx-cached-funding",
          blockTimestamp: new Date("2026-05-20T10:00:00.000Z"),
          fromAddress: seed,
          toAddress: hopAddress,
          amountRaw: "1000000"
        })];
      });

      const handled = await runCycleWithMock({
        claimNextForensicCheckJob: async () => sourceJob,
        completeForensicCheckJob,
        releaseForensicCheckJobToWaiting,
        updateForensicCheckJobProgress: vi.fn(async () => true),
        recordRiskEvaluation: vi.fn(async () => undefined),
        getAddressUsdtIndexState,
        queueAddressUsdtHistory,
        listIndexedUsdtTransfersForAddress: indexedLookup,
        tronClient: { listRelatedTrc20Transfers: async () => [] },
        getLabelsForAddress: async () => [],
        getUsdtRestrictionStatus: async (address: string) => usdtRestrictionProfile({ subjectAddress: address })
      } as any);

      expect(handled).toBe(true);
      expect(runWhereIsMoneyCheck).toHaveBeenCalledTimes(1);
      expect(indexedLookup).toHaveBeenCalledWith(hopAddress, expect.objectContaining({
        maxTimestamp: hopTimestamp
      }));
      expect(queueAddressUsdtHistory).not.toHaveBeenCalled();
      expect(releaseForensicCheckJobToWaiting).not.toHaveBeenCalled();
      expect(completeForensicCheckJob).toHaveBeenCalledWith(expect.objectContaining({
        id: sourceJob.id,
        status: "completed",
        lastError: null
      }));
      const completion = completeForensicCheckJob.mock.calls[0]?.[0];
      expect(completion).toBeDefined();
      const report = (completion!.resultJson as { whereIsMoneyReport: any }).whereIsMoneyReport;
      const path = report.originPaths[0];
      expect(path.reasons).toContain("cached_edges:1");
      expect(path.historyCoverage).toEqual(expect.arrayContaining([
        expect.objectContaining({
          address: hopAddress,
          source: "local_index",
          coverageComplete: false,
          providerCapHit: true,
          budgetExhausted: false,
          providerInconsistent: false,
          statusReason: "partial_provider_cap"
        })
      ]));
    } finally {
      vi.doUnmock("../../src/check/whereIsMoneyCheck");
      vi.resetModules();
    }
  });

  it("resumes ordinary where provider-cap terminal progress into dense-hop materiality scoring", async () => {
    vi.resetModules();
    const thjSubject = "THJcWw89zY5VAeqwtLAXj13aY7N2Y3FMD7";
    const denseHop = "TYCBsKvJSrLoj6pudJCLFNFYdBcntNP1gU";
    const cleanSource = "TCleanCex1111111111111111111111111111";
    const hopTimestamp = new Date("2026-07-01T12:39:03.000Z");
    const denseHopMateriality = {
      outcome: "dense_hop_unresolved_below_materiality",
      materialityTier: "small_relative_dense_hop_tail",
      unresolvedAmountRaw: "1562000000",
      unresolvedAmountUsdt: 1562,
      unresolvedShareOfCheckedBalance: 0.001562,
      unresolvedShareOfSelectedAmount: 0.001562,
      largestUnresolvedAmountRaw: "1562000000",
      largestUnresolvedAmountUsdt: 1562,
      aggregateUnresolvedShareOfCheckedBalance: 0.001562,
      aggregateUnresolvedShareOfSelectedAmount: 0.001562,
      unresolvedPathCount: 1,
      denseHopUnresolvedPathCount: 1,
      hardEvidenceInUnresolved: false,
      excludedFromDecisiveScore: true,
      unresolvedReasonCounts: {
        provider_cap_hit: 1,
        dense_hop_provider_cap: 1,
        funding_source_unresolved: 1
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
    };
    const runWhereIsMoneyCheck = vi.fn(async (deps: any) => {
      const denseEdges = await deps.fetchEdgesForAddress(denseHop, { latestTimestamp: hopTimestamp });
      const denseCoverage = await deps.getHistoryCoverageForAddress(denseHop, { latestTimestamp: hopTimestamp });
      return {
        subjectAddress: thjSubject,
        currentUsdtBalanceRaw: "1000000000000",
        fastWalletRisk: null,
        balanceFormingTransfers: [
          {
            txHash: "tx-clean-covered",
            fromAddress: cleanSource,
            toAddress: thjSubject,
            amountRaw: "998438000000",
            timestamp: "2026-07-01T12:30:00.000Z"
          },
          {
            txHash: "tx-dense-tail",
            fromAddress: denseHop,
            toAddress: thjSubject,
            amountRaw: "1562000000",
            timestamp: hopTimestamp.toISOString()
          }
        ],
        originPaths: [
          {
            balanceTransferTxHash: "tx-clean-covered",
            rootSourceAddress: cleanSource,
            rootSourceType: "allowlist_cex",
            pathAddresses: [cleanSource, thjSubject],
            txHashes: ["tx-clean-covered"],
            steps: [{
              txHash: "tx-clean-covered",
              fromAddress: cleanSource,
              toAddress: thjSubject,
              amountRaw: "998438000000",
              timestamp: "2026-07-01T12:30:00.000Z"
            }],
            historyCoverage: [],
            stoppedReason: "known_service_boundary",
            verdict: "ACCEPTABLE",
            riskScoreContribution: 15,
            balanceShare: 0.998438,
            amountPreservationRatio: 1,
            timeSpanMs: null,
            reasons: ["Covered clean source remains dominant."]
          },
          {
            balanceTransferTxHash: "tx-dense-tail",
            rootSourceAddress: denseHop,
            rootSourceType: "incomplete",
            pathAddresses: [denseHop, thjSubject],
            txHashes: ["tx-dense-tail"],
            steps: [{
              txHash: "tx-dense-tail",
              fromAddress: denseHop,
              toAddress: thjSubject,
              amountRaw: "1562000000",
              timestamp: hopTimestamp.toISOString()
            }],
            historyCoverage: [denseCoverage],
            stoppedReason: "incoming_history_not_fetched",
            verdict: "REVIEW",
            riskScoreContribution: 45,
            balanceShare: 0.001562,
            amountPreservationRatio: 1,
            timeSpanMs: null,
            sourceProvenance: [{
              mode: "source_provenance",
              targetTxHash: "tx-dense-tail",
              targetFromAddress: denseHop,
              targetToAddress: thjSubject,
              targetTimestamp: hopTimestamp.toISOString(),
              targetAmountRaw: "1562000000",
              proofClass: "unresolved",
              coveredAmountRaw: "0",
              coverageRatio: 0,
              amountContinuity: "strong",
              stopReason: "incoming_history_not_fetched",
              fundingBundle: null,
              coverageWindow: {
                startTimestamp: null,
                endTimestamp: hopTimestamp.toISOString(),
                complete: false,
                capped: true,
                providerInconsistent: false
              },
              reasons: ["provider_cap_hit", "dense_hop_provider_cap", "funding_source_unresolved"]
            }],
            reasons: [`Dense-hop source remains unresolved after provider-cap terminal state; cached_edges:${denseEdges.length}`]
          }
        ],
        senderInteractionProfiles: [],
        approvalDrainProvenanceProfiles: [],
        approvalDrainReviewFindings: [],
        contractLlmVerdicts: [],
        assessment: {
          decision: "REVIEW",
          riskScore: 45,
          riskBand: "MEDIUM",
          provenanceConfidence: 40,
          coverageCompleteness: 80,
          walletRole: "unknown_wallet",
          operationalLiquidityScore: 0,
          ageSignals: null,
          hardBadEvidence: [],
          sourcePolicyEvidence: [],
          contractSuspicionEvidence: [],
          unknownOriginEvidence: [],
          riskLayers: [],
          dominantRiskLayer: null,
          scoreValid: true,
          scoreBlockedReason: null,
          technicalStatus: "completed",
          sourceProvenanceMateriality: denseHopMateriality,
          reasons: ["Dense-hop unresolved source is below relative materiality."],
          warnings: ["Dense-hop unresolved source is shown as a caveat, not clean or bad evidence."]
        },
        decision: "REVIEW",
        userDecision: "REVIEW",
        internalDecision: "REVIEW",
        proofLevel: "insufficient_coverage",
        riskScore: 45,
        scoreValid: true,
        scoreBlockedReason: null,
        technicalStatus: "completed",
        sourceProvenanceMateriality: denseHopMateriality,
        decisionReasons: ["Dense-hop unresolved source is below relative materiality."],
        coverage: {
          selectedInboundTxCount: 2,
          currentBalanceRaw: "1000000000000",
          requestedAmountRaw: null,
          targetAmountRaw: "1000000000000",
          selectedAmountRaw: "1000000000000",
          coverageRatio: 1,
          selectedInboundVolumeRaw: "1000000000000",
          currentBalanceCoverageRatio: 1,
          maxDepth: 20,
          fetchedAddressCount: 2,
          partial: true,
          notes: ["Dense-hop source unresolved below materiality."]
        }
      };
    });
    vi.doMock("../../src/check/whereIsMoneyCheck", async (importOriginal) => ({
      ...await importOriginal<typeof import("../../src/check/whereIsMoneyCheck")>(),
      runWhereIsMoneyCheck
    }));

    try {
      const { runSingleDeepForensicJobCycle: runCycleWithMock } = await import("../../src/forensics/deepForensicJob");
      const sourceJob: ForensicCheckJob = {
        ...job(),
        id: "where-thj-provider-cap",
        kind: "where_is_money_check",
        subjectAddress: thjSubject,
        windowStart: new Date("2026-07-01T00:00:00.000Z"),
        windowEnd: new Date("2026-07-02T00:00:00.000Z"),
        progressJson: {
          mode: "wallet_profile",
          jobPhase: "provider_limited",
          targetedIndex: {
            phase: "provider_limited",
            scoreValid: false,
            scoreBlockedReason: "provider_cap_unresolved",
            technicalStatus: "provider_cap_unresolved",
            waitingFor: null,
            lastIndexedAddress: denseHop,
            lastIndexedTargetTimestamp: hopTimestamp.toISOString(),
            lastIndexStatus: "partial",
            statusReason: "partial_provider_cap",
            providerCapHit: true,
            budgetExhausted: false,
            fetchedPageCount: 26,
            fetchedTransferCount: 1297,
            uniqueCounterpartyCount: 1191
          }
        }
      };
      const getAddressUsdtIndexState = vi.fn(async (input: { address: string; targetTimestamp?: Date | null }) => ({
        ...queuedIndexState(input.address),
        coverageMode: "targeted",
        status: "partial",
        statusReason: "partial_provider_cap",
        targetTimestamp: input.targetTimestamp ?? null,
        providerCapHit: true,
        budgetExhausted: false,
        attemptCount: 12,
        maxAttempts: 8,
        budgetPages: 12000,
        fetchedPageCount: 26,
        fetchedTransferCount: 1297,
        uniqueCounterpartyCount: 1191
      } as any));
      const indexedLookup = vi.fn(async (address: string) => {
        if (address !== denseHop) return [];
        return [indexedTransfer({
          txHash: "tx-dense-cache-context",
          blockTimestamp: new Date("2026-07-01T12:20:00.000Z"),
          fromAddress: "TContext1111111111111111111111111111",
          toAddress: denseHop,
          amountRaw: "1000000"
        })];
      });
      const queueAddressUsdtHistory = vi.fn(async () => {
        throw new Error("terminal provider-cap resume must score cached evidence, not requeue");
      });
      const completeForensicCheckJob = vi.fn(async (_input: Parameters<Parameters<typeof runSingleDeepForensicJobCycle>[0]["completeForensicCheckJob"]>[0]) => true);

      const handled = await runCycleWithMock({
        claimNextForensicCheckJob: async () => sourceJob,
        completeForensicCheckJob,
        releaseForensicCheckJobToWaiting: vi.fn(async () => true),
        updateForensicCheckJobProgress: vi.fn(async () => true),
        recordRiskEvaluation: vi.fn(async () => undefined),
        getAddressUsdtIndexState,
        queueAddressUsdtHistory,
        listIndexedUsdtTransfersForAddress: indexedLookup,
        tronClient: { listRelatedTrc20Transfers: async () => [] },
        getLabelsForAddress: async () => [],
        getUsdtRestrictionStatus: async (address: string) => usdtRestrictionProfile({
          subjectAddress: address,
          balanceRaw: address === thjSubject ? "1000000000000" : null
        })
      } as any);

      expect(handled).toBe(true);
      expect(runWhereIsMoneyCheck).toHaveBeenCalledTimes(1);
      expect(indexedLookup).toHaveBeenCalledWith(denseHop, expect.objectContaining({
        maxTimestamp: hopTimestamp
      }));
      expect(queueAddressUsdtHistory).not.toHaveBeenCalled();
      expect(completeForensicCheckJob).toHaveBeenCalledTimes(1);
      const completion = completeForensicCheckJob.mock.calls[0]?.[0];
      if (!completion) throw new Error("expected where completion");
      expect(completion).toMatchObject({
        id: sourceJob.id,
        status: "completed",
        lastError: null,
        progressJson: expect.objectContaining({
          decision: "REVIEW",
          riskScore: 45
        }),
        resultJson: expect.objectContaining({
          scoringPolicyVersion: SCORING_SIGNAL_MATRIX_POLICY_VERSION,
          subjectAddress: thjSubject,
          score_valid: true,
          score_blocked_reason: null,
          technical_status: "completed",
          whereIsMoneyReport: expect.objectContaining({
            scoringPolicyVersion: SCORING_SIGNAL_MATRIX_POLICY_VERSION,
            decision: "REVIEW",
            userDecision: "REVIEW",
            riskScore: 45,
            scoreValid: true,
            scoreBlockedReason: null,
            technicalStatus: "completed",
            sourceProvenanceMateriality: expect.objectContaining({
              outcome: "dense_hop_unresolved_below_materiality",
              unresolvedAmountRaw: "1562000000",
              hardEvidenceInUnresolved: false,
              excludedFromDecisiveScore: true
            })
          })
        })
      });
      expect(completion.resultJson).not.toMatchObject({
        score_valid: false,
        score_blocked_reason: "provider_cap_unresolved",
        technical_status: "provider_cap_unresolved"
      });
    } finally {
      vi.doUnmock("../../src/check/whereIsMoneyCheck");
      vi.resetModules();
    }
  });

  it("repairs probable source provenance by reading only the candidate-to-target indexed window", async () => {
    const repairWallet = "TRepairWindowWallet11111111111111111";
    const targetTimestamp = new Date("2026-05-20T10:15:00.000Z");
    const fundingTimestamp = new Date("2026-05-20T10:10:00.000Z");
    const sourceJob: ForensicCheckJob = {
      ...job(),
      kind: "where_is_money_check",
      priority: 120,
      progressJson: { fastRiskSnapshot: { score: 0, level: "LOW" }, locale: "en" }
    };
    const calls: Array<{ address: string; min: number; max: number; limit: number }> = [];
    const completeForensicCheckJob = vi.fn(async (_input: Parameters<Parameters<typeof runSingleDeepForensicJobCycle>[0]["completeForensicCheckJob"]>[0]) => true);
    const targetTransfer = indexedTransfer({
      txHash: "tx-repair-hop-subject",
      blockTimestamp: targetTimestamp,
      fromAddress: repairWallet,
      toAddress: subject,
      amountRaw: "1000000000"
    });
    const fundingTransfer = indexedTransfer({
      txHash: "tx-repair-funding",
      blockTimestamp: fundingTimestamp,
      fromAddress: seed,
      toAddress: repairWallet,
      amountRaw: "1000000000"
    });

    const handled = await runSingleDeepForensicJobCycle({
      claimNextForensicCheckJob: async () => sourceJob,
      completeForensicCheckJob,
      recordRiskEvaluation: vi.fn(async () => undefined),
      listIndexedUsdtTransfersForAddress: async (address, options) => {
        calls.push({
          address,
          min: options.minTimestamp.getTime(),
          max: options.maxTimestamp.getTime(),
          limit: options.limit
        });
        if (address === subject) return [targetTransfer];
        if (address === repairWallet && options.minTimestamp.getTime() === fundingTimestamp.getTime()) {
          return [targetTransfer, fundingTransfer];
        }
        if (address === repairWallet) return [targetTransfer, fundingTransfer];
        return [];
      },
      tronClient: {
        listRelatedTrc20Transfers: async () => []
      },
      getLabelsForAddress: async () => [],
      getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({
        subjectAddress: address,
        balanceRaw: address === subject ? "1000000000" : null
      })
    }, {
      recentFallbackMinTransferCount: 0,
      maxEdgesPerAddress: 2,
      recentFallbackTransferLimit: 2,
      sourceProvenanceExactWindowRepairLimit: 10
    });

    expect(handled).toBe(true);
    const repairCall = calls.find((call) =>
      call.address === repairWallet &&
      call.min === fundingTimestamp.getTime() &&
      call.max === targetTimestamp.getTime()
    );
    expect(repairCall).toMatchObject({ limit: 10 });
    const broadHopCall = calls.find((call) =>
      call.address === repairWallet &&
      call.min === sourceJob.windowStart.getTime() &&
      call.max === targetTimestamp.getTime()
    );
    expect(broadHopCall).toMatchObject({ limit: 2 });
    const result = completeForensicCheckJob.mock.calls[0][0].resultJson as { whereIsMoneyReport: WhereIsMoneyReport };
    const sourceProvenance = result.whereIsMoneyReport.originPaths
      .find((path) => path.balanceTransferTxHash === "tx-repair-hop-subject")
      ?.sourceProvenance?.[0];
    expect(sourceProvenance).toMatchObject({
      proofClass: "exact",
      targetTxHash: "tx-repair-hop-subject",
      coverageWindow: expect.objectContaining({
        startTimestamp: fundingTimestamp.toISOString(),
        endTimestamp: targetTimestamp.toISOString(),
        complete: true
      })
    });
    expect(sourceProvenance?.reasons).toContain("exact_window_repaired");
  });

  it("keeps widened old-history coverage incomplete when the indexed page may be truncated", async () => {
    const oldSeedTimestamp = new Date("2026-04-01T10:00:00.000Z");
    const sourceJob: ForensicCheckJob = {
      ...job(),
      kind: "where_is_money_check",
      priority: 120,
      progressJson: { fastRiskSnapshot: { score: 0, level: "LOW" }, locale: "en", requestedAmountRaw: "1000000" }
    };
    const indexedLimit = 3;
    const completeForensicCheckJob = vi.fn(async (_input: Parameters<Parameters<typeof runSingleDeepForensicJobCycle>[0]["completeForensicCheckJob"]>[0]) => true);

    const handled = await runSingleDeepForensicJobCycle({
      claimNextForensicCheckJob: async () => sourceJob,
      completeForensicCheckJob,
      recordRiskEvaluation: vi.fn(async () => undefined),
      listIndexedUsdtTransfersForAddress: async (address, options) => {
        const minTimestamp = options?.minTimestamp instanceof Date ? options.minTimestamp.getTime() : null;
        const maxTimestamp = options?.maxTimestamp instanceof Date ? options.maxTimestamp.getTime() : null;
        if (address === subject && minTimestamp === 0) {
          return [indexedTransfer({
            txHash: "old-balance-seed",
            blockTimestamp: oldSeedTimestamp,
            fromAddress: transit,
            toAddress: subject,
            amountRaw: "1000000"
          })];
        }
        if (address === transit && minTimestamp === 0 && maxTimestamp === oldSeedTimestamp.getTime()) {
          return Array.from({ length: indexedLimit }, (_, index) => indexedTransfer({
            txHash: `old-transit-page-${index}`,
            blockTimestamp: new Date(oldSeedTimestamp.getTime() - (index + 1) * 60_000),
            fromAddress: transit,
            toAddress: `TOut${index.toString().padStart(30, "0")}`,
            amountRaw: "1000000",
            eventIndex: index
          }));
        }
        return [];
      },
      tronClient: {
        listRelatedTrc20Transfers: async () => []
      },
      getLabelsForAddress: async () => [],
      getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({
        subjectAddress: address,
        balanceRaw: address === subject ? "1000000" : null
      })
    }, {
      recentFallbackMinTransferCount: indexedLimit,
      maxEdgesPerAddress: indexedLimit,
      recentFallbackTransferLimit: indexedLimit
    });

    expect(handled).toBe(true);
    const result = completeForensicCheckJob.mock.calls[0][0].resultJson as { whereIsMoneyReport: WhereIsMoneyReport };
    const path = result.whereIsMoneyReport.originPaths.find((originPath) => originPath.balanceTransferTxHash === "old-balance-seed");
    expect(path?.stoppedReason).toBe("incoming_history_not_fetched");
    expect(path?.historyCoverage).toEqual(expect.arrayContaining([
      expect.objectContaining({
        address: transit,
        fetchedTransferCount: indexedLimit,
        reachedTargetHop: false,
        source: "local_index",
        coverageComplete: false,
        budgetExhausted: true,
        providerInconsistent: false
      })
    ]));
  });

  it("preserves fast-risk reason codes across queued where-is-money jobs", async () => {
    const sourceJob: ForensicCheckJob = {
      ...job(),
      kind: "where_is_money_check",
      priority: 120,
      progressJson: {
        fastRiskSnapshot: {
          score: 90,
          level: "CRITICAL",
          reasons: [{
            code: "stablecoin_usdt_blacklisted",
            message: "Official TRON USDT contract blacklist state is active for this address.",
            scoreImpact: 90,
            evidenceRef: "usdt-blacklist-evidence"
          }]
        },
        locale: "en"
      }
    };
    const completeForensicCheckJob = vi.fn(async (_input: Parameters<Parameters<typeof runSingleDeepForensicJobCycle>[0]["completeForensicCheckJob"]>[0]) => true);

    const handled = await runSingleDeepForensicJobCycle({
      claimNextForensicCheckJob: async () => sourceJob,
      completeForensicCheckJob,
      recordRiskEvaluation: vi.fn(async () => undefined),
      tronClient: {
        listRelatedTrc20Transfers: async () => []
      },
      getLabelsForAddress: async () => [],
      getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({
        subjectAddress: address,
        balanceRaw: address === subject ? "1000000" : null
      })
    }, {
      recentFallbackMinTransferCount: 60,
      maxEdgesPerAddress: 60,
      recentFallbackTransferLimit: 60
    });

    expect(handled).toBe(true);
    const result = completeForensicCheckJob.mock.calls[0][0].resultJson as { whereIsMoneyReport: WhereIsMoneyReport };
    expect(result.whereIsMoneyReport.fastWalletRisk?.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "stablecoin_usdt_blacklisted",
        evidenceRef: "usdt-blacklist-evidence"
      })
    ]));
  });

  it("preserves wallet_profile mode for zero-balance queued where-is-money jobs", async () => {
    const zeroBalanceReason = "Current USDT balance is zero; balance-origin mode is not applicable for this wallet profile check.";
    const sourceJob: ForensicCheckJob = {
      ...job(),
      kind: "where_is_money_check",
      priority: 120,
      progressJson: { fastRiskSnapshot: { score: 0, level: "LOW" }, locale: "en", mode: "wallet_profile" }
    };
    const completeForensicCheckJob = vi.fn(async (_input: Parameters<Parameters<typeof runSingleDeepForensicJobCycle>[0]["completeForensicCheckJob"]>[0]) => true);

    const handled = await runSingleDeepForensicJobCycle({
      claimNextForensicCheckJob: async () => sourceJob,
      completeForensicCheckJob,
      recordRiskEvaluation: vi.fn(async () => undefined),
      tronClient: {
        listRelatedTrc20Transfers: async () => []
      },
      getLabelsForAddress: async () => [],
      getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({
        subjectAddress: address,
        balanceRaw: address === subject ? "0" : null
      })
    }, {
      recentFallbackMinTransferCount: 60,
      maxEdgesPerAddress: 60,
      recentFallbackTransferLimit: 60
    });

    expect(handled).toBe(true);
    const result = completeForensicCheckJob.mock.calls[0][0].resultJson as { whereIsMoneyReport: WhereIsMoneyReport };
    expect(result.whereIsMoneyReport).toMatchObject({
      currentUsdtBalanceRaw: "0",
      decision: "REVIEW",
      internalDecision: "REVIEW",
      userDecision: "NO_FINAL_DECISION",
      proofLevel: "insufficient_coverage",
      scoreValid: false,
      riskScore: 0,
      coverage: expect.objectContaining({
        selectedInboundTxCount: 0,
        questionStatus: "not_applicable",
        partial: false
      })
    });
    expect(result.whereIsMoneyReport.coverage.notes).toContain(zeroBalanceReason);
    expect(result.whereIsMoneyReport.decisionReasons).toContain(zeroBalanceReason);
    expect(result.whereIsMoneyReport.assessment.reasons).toContain(zeroBalanceReason);
    expect(result.whereIsMoneyReport.decisionReasons.join(" ")).not.toContain("Clean source could not be proven");
  });

  it("keeps live-only trace history coverage incomplete when the live page may be truncated", async () => {
    const sourceJob: ForensicCheckJob = {
      ...job(),
      kind: "where_is_money_check",
      priority: 120,
      progressJson: { fastRiskSnapshot: { score: 0, level: "LOW" }, locale: "en" }
    };
    const liveLimit = 60;
    const unrelatedLiveRows = Array.from({ length: liveLimit }, (_, index) =>
      transfer({
        id: `tx-live-page-${index}`,
        from: transit,
        to: `TOut${index.toString().padStart(30, "0")}`,
        amountRaw: "1000000",
        at: `2026-05-20T09:${String(index % 60).padStart(2, "0")}:00.000Z`
      })
    );
    const completeForensicCheckJob = vi.fn(async (_input: Parameters<Parameters<typeof runSingleDeepForensicJobCycle>[0]["completeForensicCheckJob"]>[0]) => true);

    const handled = await runSingleDeepForensicJobCycle({
      claimNextForensicCheckJob: async () => sourceJob,
      completeForensicCheckJob,
      recordRiskEvaluation: vi.fn(async () => undefined),
      listIndexedUsdtTransfersForAddress: async () => [],
      tronClient: {
        listRelatedTrc20Transfers: async (address) => {
          if (address === subject) {
            return [transfer({
              id: "tx-transit-subject",
              from: transit,
              to: subject,
              amountRaw: "95000000000",
              at: "2026-05-20T10:00:00.000Z"
            })];
          }
          if (address === transit) return unrelatedLiveRows;
          return [];
        }
      },
      getLabelsForAddress: async () => [],
      getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({
        subjectAddress: address,
        balanceRaw: address === subject ? "95000000000" : null
      })
    }, {
      recentFallbackMinTransferCount: liveLimit,
      maxEdgesPerAddress: liveLimit,
      recentFallbackTransferLimit: liveLimit
    });

    expect(handled).toBe(true);
    const result = completeForensicCheckJob.mock.calls[0][0].resultJson as { whereIsMoneyReport: WhereIsMoneyReport };
    const path = result.whereIsMoneyReport.originPaths.find((originPath) => originPath.balanceTransferTxHash === "tx-transit-subject");
    expect(path?.stoppedReason).toBe("incoming_history_not_fetched");
    expect(path?.historyCoverage).toEqual(expect.arrayContaining([
      expect.objectContaining({
        address: transit,
        fetchedTransferCount: liveLimit,
        fetchedPageCount: 2,
        reachedTargetHop: false,
        source: "live",
        coverageComplete: false,
        budgetExhausted: true,
        providerInconsistent: false
      })
    ]));
  });

  it("does not treat failed transit history fetches as reached history", async () => {
    const sourceJob: ForensicCheckJob = {
      ...job(),
      kind: "where_is_money_check",
      priority: 120,
      progressJson: { fastRiskSnapshot: { score: 0, level: "LOW" }, locale: "en" }
    };
    const completeForensicCheckJob = vi.fn(async (_input: Parameters<Parameters<typeof runSingleDeepForensicJobCycle>[0]["completeForensicCheckJob"]>[0]) => true);

    const handled = await runSingleDeepForensicJobCycle({
      claimNextForensicCheckJob: async () => sourceJob,
      completeForensicCheckJob,
      recordRiskEvaluation: vi.fn(async () => undefined),
      listIndexedUsdtTransfersForAddress: async (address) => {
        if (address === transit) throw new Error("index unavailable");
        return [];
      },
      tronClient: {
        listRelatedTrc20Transfers: async (address) => {
          if (address === subject) {
            return [transfer({
              id: "tx-transit-subject",
              from: transit,
              to: subject,
              amountRaw: "95000000000",
              at: "2026-05-20T10:00:00.000Z"
            })];
          }
          if (address === transit) throw new Error("provider unavailable");
          return [];
        }
      },
      getLabelsForAddress: async () => [],
      getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({
        subjectAddress: address,
        balanceRaw: address === subject ? "95000000000" : null
      })
    }, {
      recentFallbackMinTransferCount: 60,
      maxEdgesPerAddress: 60,
      recentFallbackTransferLimit: 60
    });

    expect(handled).toBe(true);
    const result = completeForensicCheckJob.mock.calls[0][0].resultJson as { whereIsMoneyReport: WhereIsMoneyReport };
    const path = result.whereIsMoneyReport.originPaths.find((originPath) => originPath.balanceTransferTxHash === "tx-transit-subject");
    expect(path?.stoppedReason).toBe("incoming_history_not_fetched");
    expect(path?.historyCoverage).toEqual(expect.arrayContaining([
      expect.objectContaining({
        address: transit,
        fetchedTransferCount: 0,
        reachedTargetHop: false,
        coverageComplete: false,
        providerInconsistent: true,
        statusReason: "partial_provider_inconsistent"
      })
    ]));
  });

  it("forwards Stage 2 providers and options into where-is-money jobs", async () => {
    const sourceJob: ForensicCheckJob = {
      ...job(),
      kind: "where_is_money_check",
      priority: 120,
      progressJson: { fastRiskSnapshot: { score: 9, level: "LOW" }, locale: "en" }
    };
    const transfersByAddress = new Map<string, RawTronscanTrc20Transfer[]>([
      [
        subject,
        [
          transfer({
            id: "tx-transit-subject",
            from: transit,
            to: subject,
            amountRaw: "95000000000",
            at: "2026-05-20T10:00:00.000Z"
          })
        ]
      ],
      [
        transit,
        [
          transfer({
            id: "tx-seed-transit",
            from: seed,
            to: transit,
            amountRaw: "100000000000",
            at: "2026-05-20T09:55:00.000Z"
          }),
          transfer({
            id: "tx-transit-subject",
            from: transit,
            to: subject,
            amountRaw: "95000000000",
            at: "2026-05-20T10:00:00.000Z"
          })
        ]
      ]
    ]);
    const payloadRef: ProviderPayloadRef = {
      id: "range:transfers/by-tx:tron:tx-seed-transit",
      provider: "range",
      endpoint: "transfers/by-tx",
      fetchedAt: "2026-05-20T10:01:00.000Z"
    };
    const evidenceRef: CrossChainEvidenceRef = {
      id: "range:ethereum:tx-seed-transit:bridge_source",
      provider: "range",
      payloadId: payloadRef.id,
      confidence: "provider_correlated"
    };
    const crossChainTransfer: CrossChainTransfer = {
      id: "range-transfer-1",
      protocol: "LayerZero/Stargate",
      source: { chain: "tron", chainId: "tron-mainnet", address: seed },
      destination: { chain: "ethereum", chainId: 1, address: "0x2222222222222222222222222222222222222222" },
      sourceTxHash: "tx-seed-transit",
      destinationTxHash: "0xstage2",
      assetSymbol: "USDT",
      amountRaw: "100000000000",
      decimals: 6,
      timestamp: "2026-05-20T09:55:00.000Z",
      evidenceRefs: [evidenceRef],
      payloadRef,
      labels: ["bridge"]
    };
    const crossChainDiscoveryProvider = {
      findTransfersByTx: vi.fn(async () => [crossChainTransfer]),
      findTransfersByAddress: vi.fn(async () => []),
      getAddressRisk: vi.fn(async () => null)
    };
    const evmEvidenceProvider = {
      listNormalTransactions: vi.fn(async () => []),
      listInternalTransactions: vi.fn(async () => []),
      listErc20Transfers: vi.fn(async () => []),
      getTransactionReceipt: vi.fn(async () => null),
      getLogs: vi.fn(async () => []),
      getTokenMetadata: vi.fn(async () => null)
    };
    const completeForensicCheckJob = vi.fn(async (_input: Parameters<Parameters<typeof runSingleDeepForensicJobCycle>[0]["completeForensicCheckJob"]>[0]) => true);
    const updateForensicCheckJobProgress = vi.fn(async (_input: {
      id: string;
      progressJson: Record<string, unknown>;
      lastError?: string | null;
    }) => true);

    const handled = await runSingleDeepForensicJobCycle({
      claimNextForensicCheckJob: async () => sourceJob,
      updateForensicCheckJobProgress,
      completeForensicCheckJob,
      recordRiskEvaluation: vi.fn(async () => undefined),
      tronClient: {
        listRelatedTrc20Transfers: async (address) => transfersByAddress.get(address) ?? []
      },
      getLabelsForAddress: async (address) => address === seed ? [darknetExchangeLabel(address)] : [],
      getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({ subjectAddress: address, balanceRaw: address === subject ? "95000000000" : null }),
      crossChainDiscoveryProvider,
      evmEvidenceProvider
    }, {
      recentFallbackMinTransferCount: 60,
      maxEdgesPerAddress: 60,
      recentFallbackTransferLimit: 60,
      crossChainStage2Enabled: true,
      crossChainManualDeepMode: true,
      crossChainMaxProviderCalls: 1
    });

    expect(handled).toBe(true);
    expect(crossChainDiscoveryProvider.findTransfersByTx).toHaveBeenCalledTimes(1);
    expect(crossChainDiscoveryProvider.findTransfersByAddress).not.toHaveBeenCalled();
    expect(evmEvidenceProvider.listNormalTransactions).not.toHaveBeenCalled();
    expect(updateForensicCheckJobProgress).toHaveBeenCalledTimes(2);
    expect(updateForensicCheckJobProgress.mock.calls[0][0]).toMatchObject({
      id: "job-1",
      lastError: null,
      progressJson: {
        locale: "en",
        jobPhase: "money_origin_trace",
        jobHeartbeatAt: expect.any(String),
        crossChainStage2Progress: {
          enabled: true,
          manualDeepMode: true,
          status: "pending",
          updatedAt: expect.any(String)
        }
      }
    });
    expect(updateForensicCheckJobProgress.mock.calls[1][0]).toMatchObject({
      id: "job-1",
      lastError: null,
      progressJson: {
        locale: "en",
        jobPhase: "cross_chain_stage2",
        jobHeartbeatAt: expect.any(String),
        crossChainStage2Progress: {
          enabled: true,
          manualDeepMode: true,
          status: "running",
          triggered: true,
          reason: "manual_deep_mode",
          selectedAmountRaw: "95000000000",
          targetAmountRaw: "95000000000",
          providerCalls: 0,
          updatedAt: expect.any(String)
        }
      }
    });
    expect(completeForensicCheckJob.mock.calls[0][0].resultJson).toMatchObject({
      whereIsMoneyReport: {
        crossChainCorridor: {
          enabled: true,
          triggered: true,
          providerCalls: 1
        }
      }
    });
    expect(completeForensicCheckJob.mock.calls[0][0].progressJson).toMatchObject({
      locale: "en",
      jobPhase: "cross_chain_stage2",
      crossChainStage2Progress: updateForensicCheckJobProgress.mock.calls[1][0].progressJson.crossChainStage2Progress,
      whereIsMoneyCoverage: expect.any(Object),
      decision: expect.any(String),
      riskScore: expect.any(Number)
    });
  });

  it("does not run cross-chain Stage 2 for unseeded runtime jobs", async () => {
    const sourceJob: ForensicCheckJob = {
      ...job(),
      kind: "where_is_money_check",
      priority: 120,
      progressJson: { fastRiskSnapshot: { score: 9, level: "LOW" }, locale: "en" }
    };
    const transfersByAddress = new Map<string, RawTronscanTrc20Transfer[]>([[
      subject,
      [transfer({
        id: "tx-clean-subject",
        from: transit,
        to: subject,
        amountRaw: "95000000000",
        at: "2026-05-20T10:00:00.000Z"
      })]
    ]]);
    const crossChainDiscoveryProvider = {
      findTransfersByTx: vi.fn(async () => []),
      findTransfersByAddress: vi.fn(async () => []),
      getAddressRisk: vi.fn(async () => null)
    };
    const completeForensicCheckJob = vi.fn(async (_input: Parameters<Parameters<typeof runSingleDeepForensicJobCycle>[0]["completeForensicCheckJob"]>[0]) => true);

    const handled = await runSingleDeepForensicJobCycle({
      claimNextForensicCheckJob: async () => sourceJob,
      completeForensicCheckJob,
      recordRiskEvaluation: vi.fn(async () => undefined),
      tronClient: {
        listRelatedTrc20Transfers: async (address) => transfersByAddress.get(address) ?? []
      },
      getLabelsForAddress: async () => [],
      getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({ subjectAddress: address, balanceRaw: address === subject ? "95000000000" : null }),
      crossChainDiscoveryProvider
    }, {
      recentFallbackMinTransferCount: 60,
      maxEdgesPerAddress: 60,
      recentFallbackTransferLimit: 60,
      crossChainStage2Enabled: true,
      crossChainMaxProviderCalls: 1
    });

    expect(handled).toBe(true);
    expect(crossChainDiscoveryProvider.findTransfersByTx).not.toHaveBeenCalled();
    expect(crossChainDiscoveryProvider.findTransfersByAddress).not.toHaveBeenCalled();
    const result = completeForensicCheckJob.mock.calls[0][0].resultJson;
    const whereReport = result.whereIsMoneyReport as { crossChainCorridor?: unknown } | undefined;
    expect(whereReport?.crossChainCorridor).toBeUndefined();
  });

  it("persists address-deep trace progress before completing address jobs", async () => {
    const calls: string[] = [];
    const updateForensicCheckJobProgress = vi.fn(async (_input: {
      id: string;
      progressJson: Record<string, unknown>;
      lastError?: string | null;
    }) => {
      calls.push("progress");
      return true;
    });
    const completeForensicCheckJob = vi.fn(async (_input: Parameters<Parameters<typeof runSingleDeepForensicJobCycle>[0]["completeForensicCheckJob"]>[0]) => {
      calls.push("complete");
      return true;
    });

    const handled = await runSingleDeepForensicJobCycle({
      claimNextForensicCheckJob: async () => job(),
      updateForensicCheckJobProgress,
      completeForensicCheckJob,
      recordRiskEvaluation: vi.fn(async () => undefined),
      tronClient: {
        listRelatedTrc20Transfers: async () => []
      },
      getLabelsForAddress: async () => [],
      getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({ subjectAddress: address })
    }, {
      pageLimit: 10,
      maxPagesPerAddress: 1,
      maxExpandedIntermediates: 0,
      metadataFetchLimit: 0,
      contractProfileFetchLimit: 0,
      maxInboundSenders: 0
    });

    expect(handled).toBe(true);
    expect(calls[0]).toBe("progress");
    expect(calls.at(-1)).toBe("complete");
    expect(updateForensicCheckJobProgress).toHaveBeenCalledWith(expect.objectContaining({
      id: "job-1",
      lastError: null,
      progressJson: expect.objectContaining({
        fastRiskSnapshot: { score: 0, level: "LOW" },
        jobPhase: "address_deep_trace",
        jobHeartbeatAt: expect.any(String)
      })
    }));
    expect(completeForensicCheckJob.mock.calls[0][0].progressJson).toMatchObject({
      jobPhase: "address_deep_trace",
      fastRiskSnapshot: { score: 0, level: "LOW" }
    });
  });

  it("persists a system-derived high-risk marker for exact darknet exchange provenance", async () => {
    const transfersByAddress = new Map<string, RawTronscanTrc20Transfer[]>([
      [
        subject,
        [
          transfer({
            id: "tx-transit-subject",
            from: transit,
            to: subject,
            amountRaw: "95000000000",
            at: "2026-05-20T10:00:00.000Z"
          })
        ]
      ],
      [
        transit,
        [
          transfer({
            id: "tx-seed-transit",
            from: seed,
            to: transit,
            amountRaw: "100000000000",
            at: "2026-05-20T09:55:00.000Z"
          }),
          transfer({
            id: "tx-transit-subject",
            from: transit,
            to: subject,
            amountRaw: "95000000000",
            at: "2026-05-20T10:00:00.000Z"
          })
        ]
      ]
    ]);
    const upsertAddressLabelAssertion = vi.fn(async (_input: AddressLabelAssertionInput) => undefined);
    const completeForensicCheckJob = vi.fn(async (_input: Parameters<Parameters<typeof runSingleDeepForensicJobCycle>[0]["completeForensicCheckJob"]>[0]) => true);

    const handled = await runSingleDeepForensicJobCycle({
      claimNextForensicCheckJob: async () => job(),
      completeForensicCheckJob,
      recordRiskEvaluation: vi.fn(async () => undefined),
      upsertAddressLabelAssertion,
      tronClient: {
        listRelatedTrc20Transfers: async (address) => transfersByAddress.get(address) ?? []
      },
      getLabelsForAddress: async (address) => address === seed ? [darknetExchangeLabel(address)] : [],
      getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({ subjectAddress: address })
    }, {
      pageLimit: 10,
      maxPagesPerAddress: 1,
      maxExpandedIntermediates: 0,
      metadataFetchLimit: 0,
      contractProfileFetchLimit: 0,
      maxInboundSenders: 1
    });

    expect(handled).toBe(true);
    expect(upsertAddressLabelAssertion).toHaveBeenCalledWith(expect.objectContaining({
      id: `derived_tron_darknet_exchange_proximity_${subject}`,
      chain: "tron",
      address: subject,
      label: "darknet_exchange_proximity",
      category: "darknet_exchange_proximity",
      confidence: "high",
      severity: "high",
      status: "active",
      sourceName: "forensic_route_search",
      createdByTelegramId: null,
      derivedLabelSource: "system"
    }));
    expect(upsertAddressLabelAssertion.mock.calls[0][0].evidenceJson).toMatchObject({
      subjectAddress: subject,
      seedAddress: seed,
      hopDepth: 2,
      viaAddresses: [transit],
      txHashes: ["tx-seed-transit", "tx-transit-subject"],
      amountPreservationRatio: 0.95,
      jobId: "job-1"
    });
    expect(completeForensicCheckJob.mock.calls[0][0].resultJson).toMatchObject({
      derivedLabel: {
        label: "darknet_exchange_proximity",
        assertionId: `derived_tron_darknet_exchange_proximity_${subject}`
      },
      coverageDebug: expect.objectContaining({
        subjectAddress: subject,
        summary: expect.objectContaining({
          directCounterpartyCount: expect.any(Number),
          historicalFallbackRequestedLimit: 150
        })
      })
    });
  });

  it("uses latest 150 historical transfers by default for sparse deep jobs below 150 window transfers", async () => {
    const calls: Array<{ address: string; hasWindow: boolean; limit?: number }> = [];
    const windowTransfers = Array.from({ length: 12 }, (_, index) =>
      transfer({
        id: `tx-window-${index}`,
        from: `TIn${index.toString().padStart(30, "0")}`,
        to: subject,
        amountRaw: "1000000000",
        at: "2026-05-20T10:00:00.000Z"
      })
    );
    const latestTransfers = [
      ...windowTransfers,
      transfer({
        id: "tx-historical-extra",
        from: "THistoricalExtra1111111111111111111",
        to: subject,
        amountRaw: "1000000000",
        at: "2026-04-01T10:00:00.000Z"
      })
    ];
    const completeForensicCheckJob = vi.fn(async (_input: Parameters<Parameters<typeof runSingleDeepForensicJobCycle>[0]["completeForensicCheckJob"]>[0]) => true);

    const handled = await runSingleDeepForensicJobCycle({
      claimNextForensicCheckJob: async () => job(),
      completeForensicCheckJob,
      recordRiskEvaluation: vi.fn(async () => undefined),
      tronClient: {
        listRelatedTrc20Transfers: async (address, options) => {
          calls.push({ address, hasWindow: Boolean(options?.minTimestamp), limit: options?.limit });
          if (address !== subject) return [];
          return options?.minTimestamp ? windowTransfers : latestTransfers;
        }
      },
      getLabelsForAddress: async () => [],
      getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({ subjectAddress: address })
    }, {
      pageLimit: 20,
      maxPagesPerAddress: 1,
      maxExpandedIntermediates: 0,
      metadataFetchLimit: 0,
      contractProfileFetchLimit: 0,
      maxInboundSenders: 0
    });

    expect(handled).toBe(true);
    expect(calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ address: subject, hasWindow: false, limit: 150 })
    ]));
    expect(completeForensicCheckJob.mock.calls[0][0].resultJson.coverageDebug).toMatchObject({
      summary: expect.objectContaining({
        thirtyDayTransferCount: 12,
        historicalFallbackTransferCount: 13,
        historicalFallbackRequestedLimit: 150
      })
    });
  });

  it("persists a system-derived marker for meaningful direct exposure to a high-risk counterparty", async () => {
    const transfersByAddress = new Map<string, RawTronscanTrc20Transfer[]>([
      [
        subject,
        [
          transfer({
            id: "tx-subject-counterparty",
            from: subject,
            to: seed,
            amountRaw: "120000000000",
            at: "2026-05-20T10:00:00.000Z"
          })
        ]
      ]
    ]);
    const upsertAddressLabelAssertion = vi.fn(async (_input: AddressLabelAssertionInput) => undefined);
    const completeForensicCheckJob = vi.fn(async (_input: Parameters<Parameters<typeof runSingleDeepForensicJobCycle>[0]["completeForensicCheckJob"]>[0]) => true);

    const handled = await runSingleDeepForensicJobCycle({
      claimNextForensicCheckJob: async () => job(),
      completeForensicCheckJob,
      recordRiskEvaluation: vi.fn(async () => undefined),
      upsertAddressLabelAssertion,
      tronClient: {
        listRelatedTrc20Transfers: async (address) => transfersByAddress.get(address) ?? []
      },
      getLabelsForAddress: async (address) => address === seed ? [darknetExchangeProximityLabel(address)] : [],
      getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({ subjectAddress: address })
    }, {
      pageLimit: 10,
      maxPagesPerAddress: 1,
      maxExpandedIntermediates: 0,
      metadataFetchLimit: 0,
      contractProfileFetchLimit: 0,
      maxInboundSenders: 1
    });

    expect(handled).toBe(true);
    expect(upsertAddressLabelAssertion).toHaveBeenCalledWith(expect.objectContaining({
      id: `derived_tron_darknet_exchange_proximity_${subject}`,
      address: subject,
      label: "darknet_exchange_proximity",
      sourceName: "forensic_route_search",
      derivedLabelSource: "system"
    }));
    expect(upsertAddressLabelAssertion.mock.calls[0][0].evidenceJson).toMatchObject({
      subjectAddress: subject,
      counterpartyAddress: seed,
      counterpartyLabel: "darknet_exchange_proximity",
      direction: "outbound",
      txHashes: ["tx-subject-counterparty"],
      amountRaw: "120000000000",
      volumeRatio: 1,
      jobId: "job-1"
    });
    expect(completeForensicCheckJob.mock.calls[0][0].resultJson).toMatchObject({
      derivedLabel: {
        label: "darknet_exchange_proximity",
        assertionId: `derived_tron_darknet_exchange_proximity_${subject}`
      }
    });
  });

  it("persists a system-derived approval-drain proximity marker from exact transferFrom provenance", async () => {
    const transfersByAddress = new Map<string, RawTronscanTrc20Transfer[]>([
      [
        subject,
        [
          transfer({
            id: "tx-receiver-subject",
            from: transit,
            to: subject,
            amountRaw: "309000000000",
            at: "2026-05-20T10:05:00.000Z"
          })
        ]
      ],
      [
        transit,
        [
          transfer({
            id: "tx-drain",
            from: victim,
            to: transit,
            amountRaw: "311851000000",
            at: "2026-05-20T10:00:00.000Z",
            triggerInfo: { methodName: "transferFrom", methodId: "23b872dd" }
          }),
          transfer({
            id: "tx-receiver-subject",
            from: transit,
            to: subject,
            amountRaw: "309000000000",
            at: "2026-05-20T10:05:00.000Z"
          })
        ]
      ]
    ]);
    const upsertAddressLabelAssertion = vi.fn(async (_input: AddressLabelAssertionInput) => undefined);
    const completeForensicCheckJob = vi.fn(async (_input: Parameters<Parameters<typeof runSingleDeepForensicJobCycle>[0]["completeForensicCheckJob"]>[0]) => true);

    const handled = await runSingleDeepForensicJobCycle({
      claimNextForensicCheckJob: async () => job(),
      completeForensicCheckJob,
      recordRiskEvaluation: vi.fn(async () => undefined),
      upsertAddressLabelAssertion,
      tronClient: {
        listRelatedTrc20Transfers: async (address) => transfersByAddress.get(address) ?? []
      },
      getLabelsForAddress: async () => [],
      getTransaction: async (txHash) => txHash === "tx-drain" ? { ownerAddress: spender } : {},
      listTrc20ApprovalChanges: async () => [approval()],
      getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({ subjectAddress: address })
    }, {
      pageLimit: 10,
      maxPagesPerAddress: 1,
      maxExpandedIntermediates: 0,
      metadataFetchLimit: 0,
      contractProfileFetchLimit: 0,
      maxInboundSenders: 1,
      maxApprovalDrainCandidates: 5,
      approvalChangeLookupLimit: 5
    });

    expect(handled).toBe(true);
    expect(upsertAddressLabelAssertion).toHaveBeenCalledWith(expect.objectContaining({
      id: `derived_tron_approval_drain_proximity_${subject}`,
      chain: "tron",
      address: subject,
      label: "approval_drain_proximity",
      category: "approval_drain_proximity",
      confidence: "high",
      severity: "high",
      status: "active",
      sourceName: "forensic_route_search",
      createdByTelegramId: null,
      derivedLabelSource: "system"
    }));
    expect(upsertAddressLabelAssertion.mock.calls[0][0].evidenceJson).toMatchObject({
      subjectAddress: subject,
      victimAddress: victim,
      spenderAddress: spender,
      firstReceiverAddress: transit,
      hopDepth: 1,
      approvalTxHash: "tx-approval",
      drainTxHash: "tx-drain",
      pathTxHashes: ["tx-drain", "tx-receiver-subject"],
      pathAddresses: [victim, transit, subject],
      amountRaw: "309000000000",
      score: 80,
      evidenceStrength: "route_linked",
      jobId: "job-1"
    });
    expect(completeForensicCheckJob.mock.calls[0][0].resultJson).toMatchObject({
      approvalDrainProvenanceProfiles: [
        expect.objectContaining({
          score: 80,
          approvalTxHash: "tx-approval",
          drainTxHash: "tx-drain"
        })
      ],
      derivedLabel: {
        label: "approval_drain_proximity",
        assertionId: `derived_tron_approval_drain_proximity_${subject}`
      }
    });
  });

  it("carries exact USDT blacklist state into deep job evidence and result JSON", async () => {
    const transfersByAddress = new Map<string, RawTronscanTrc20Transfer[]>([
      [
        subject,
        [
          transfer({
            id: "tx-benign",
            from: "TOther1111111111111111111111111111111",
            to: subject,
            amountRaw: "1000000000",
            at: "2026-05-20T10:00:00.000Z"
          })
        ]
      ]
    ]);
    const completeForensicCheckJob = vi.fn(async (_input: Parameters<Parameters<typeof runSingleDeepForensicJobCycle>[0]["completeForensicCheckJob"]>[0]) => true);
    const recordedEvaluations: Array<{ observations: unknown[] }> = [];
    const sentReports: DeepAddressForensicReport[] = [];
    const recordRiskEvaluation = vi.fn(async (input: { rawEvidence: unknown[]; observations: unknown[] }) => {
      recordedEvaluations.push(input);
    });
    const buildJobResultPayload = vi.fn(async (_job: ForensicCheckJob, report: DeepAddressForensicReport) => {
      sentReports.push(report);
      return {
        version: "telegram-message-payload-v1" as const,
        chatId: "42",
        text: "deep-result",
        parseMode: "HTML" as const,
        replyMarkup: null
      };
    });

    const handled = await runSingleDeepForensicJobCycle({
      claimNextForensicCheckJob: async () => job(),
      completeForensicCheckJob,
      recordRiskEvaluation,
      upsertAddressLabelAssertion: vi.fn(async (_input: AddressLabelAssertionInput) => undefined),
      tronClient: {
        listRelatedTrc20Transfers: async (address) => transfersByAddress.get(address) ?? []
      },
      getLabelsForAddress: async () => [],
      getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({
        subjectAddress: address,
        isBlacklisted: true,
        balanceRaw: "2642746070000",
        blacklistEventTxHash: "tx-blacklist"
      }),
      buildJobResultPayload
    }, {
      pageLimit: 10,
      maxPagesPerAddress: 1,
      maxExpandedIntermediates: 0,
      metadataFetchLimit: 0,
      contractProfileFetchLimit: 0,
      maxInboundSenders: 1
    });

    expect(handled).toBe(true);
    expect(recordedEvaluations[0]?.observations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "stablecoin_usdt_blacklisted",
        scoreImpact: 90,
        severity: "critical"
      })
    ]));
    expect(completeForensicCheckJob.mock.calls[0][0].resultJson).toMatchObject({
      scoringPolicyVersion: SCORING_SIGNAL_MATRIX_POLICY_VERSION,
      stablecoinRestrictionProfiles: [
        expect.objectContaining({
          subjectAddress: subject,
          isBlacklisted: true,
          balanceRaw: "2642746070000",
          blacklistEventTxHash: "tx-blacklist"
        })
      ]
    });
    expect(sentReports[0]?.stablecoinRestrictionProfiles).toEqual([
      expect.objectContaining({
        isBlacklisted: true
      })
    ]);
    expect(sentReports[0]?.scoringPolicyVersion).toBe(SCORING_SIGNAL_MATRIX_POLICY_VERSION);
  });

  it("marks a resumed ordinary Where terminal provider result with matrix v2", async () => {
    const sourceJob: ForensicCheckJob = {
      ...job(),
      kind: "where_is_money_check",
      progressJson: {
        jobPhase: "provider_limited",
        targetedIndex: {
          statusReason: "failed_terminal",
          lastError: "provider unavailable"
        }
      }
    };
    const completeForensicCheckJob = vi.fn(async () => true);
    const buildWhereIsMoneyJobFailurePayload = vi.fn(async () => ({
      version: "telegram-message-payload-v1" as const,
      chatId: "42",
      text: "where-failed",
      parseMode: "HTML" as const,
      replyMarkup: null
    }));

    const handled = await runSingleDeepForensicJobCycle({
      claimNextForensicCheckJob: async () => sourceJob,
      completeForensicCheckJob,
      buildWhereIsMoneyJobFailurePayload,
      recordRiskEvaluation: vi.fn(async () => undefined),
      tronClient: { listRelatedTrc20Transfers: async () => [] },
      getLabelsForAddress: async () => [],
      getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({ subjectAddress: address })
    });

    expect(handled).toBe(true);
    expect(completeForensicCheckJob).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed",
      resultJson: expect.objectContaining({
        scoringPolicyVersion: SCORING_SIGNAL_MATRIX_POLICY_VERSION,
        subjectAddress: subject,
        score_valid: false
      }),
      progressJson: expect.objectContaining({
        telegramDelivery: expect.objectContaining({
          payload: expect.objectContaining({ chatId: "42", text: "where-failed" }),
          state: expect.objectContaining({ status: "pending", attemptCount: 0 }),
          claim: null
        })
      })
    }));
    expect(buildWhereIsMoneyJobFailurePayload).toHaveBeenCalledTimes(1);
  });

  it("persists JSON-safe first-hop timeline facts and coverage in deep result and progress", async () => {
    const counterparty = "TJobFirstHopBlacklisted1111111111111";
    const directTxHash = "a".repeat(64);
    const eventTxHash = "b".repeat(64);
    const sourceJob = job();
    const completeForensicCheckJob = vi.fn(async (_input: DeepForensicCompletionInput) => true);

    const handled = await runSingleDeepForensicJobCycle({
      claimNextForensicCheckJob: async () => sourceJob,
      completeForensicCheckJob,
      recordRiskEvaluation: vi.fn(async () => undefined),
      upsertAddressLabelAssertion: vi.fn(async () => undefined),
      tronClient: {
        listRelatedTrc20Transfers: async (address) => address === subject ? [transfer({
          id: directTxHash,
          from: counterparty,
          to: subject,
          amountRaw: "10000000000",
          at: "2026-05-20T10:00:00.000Z"
        })] : []
      },
      getLabelsForAddress: async (address) => address === counterparty ? [{
        address,
        label: "phishing",
        source: "service_admin",
        createdByTelegramId: "1",
        createdAt: new Date("2026-05-01T00:00:00.000Z")
      }] : [],
      getUsdtRestrictionStatus: async (address, options) => ({
        ...usdtRestrictionProfile({
          subjectAddress: address,
          isBlacklisted: address === counterparty,
          blacklistEventTxHash: address === counterparty ? eventTxHash : null,
          blacklistEventTimestamp: address === counterparty ? "2026-05-10T00:00:00.000Z" : null,
          blacklistEventBlock: address === counterparty ? 10 : null
        }),
        blacklistTimeline: address === counterparty && options?.includeEventTimeline === true ? {
          address,
          events: [{
            eventKind: "added" as const,
            address,
            tokenContract: TRON_USDT_CONTRACT_ADDRESS,
            occurredAt: "2026-05-10T00:00:00.000Z",
            txHash: eventTxHash,
            blockNumber: 10,
            logIndex: 2,
            verification: "verified_contract_log" as const
          }],
          pagination: "complete" as const,
          failureReason: null,
          checkedAt: "2026-05-24T00:00:00.000Z"
        } : null
      })
    }, {
      pageLimit: 10,
      maxPagesPerAddress: 1,
      maxExpandedIntermediates: 0,
      metadataFetchLimit: 0,
      contractProfileFetchLimit: 0,
      maxInboundSenders: 0,
      extendedSearchMode: "disabled",
      recentFallbackMinTransferCount: 0,
      recentFallbackTransferLimit: 0
    });

    expect(handled).toBe(true);
    const completion = completeForensicCheckJob.mock.calls[0]?.[0];
    const serialized = JSON.parse(JSON.stringify(completion));
    expect(serialized.resultJson).toMatchObject({
      scoringPolicyVersion: SCORING_SIGNAL_MATRIX_POLICY_VERSION,
      firstHopBlacklistFacts: [expect.objectContaining({
        counterpartyAddress: counterparty,
        direction: "inbound",
        principalAmountRaw: "10000000000",
        transferTxHashes: [directTxHash],
        activeAmountRaw: "10000000000",
        timelineEvents: [expect.objectContaining({ txHash: eventTxHash, logIndex: 2 })]
      })],
      firstHopLabelFacts: [expect.objectContaining({
        counterpartyAddress: counterparty,
        direction: "inbound",
        principalAmountRaw: "10000000000",
        transferTxHashes: [directTxHash],
        linkedToSelectedProvenance: false
      })],
      firstHopBlacklistCoverage: expect.objectContaining({
        requiredForDecision: true,
        scope: "checked_window",
        directPrincipalTransferCoverage: "partial",
        blacklistCheckCoverage: "history_partial"
      })
    });
    expect(serialized.progressJson).toMatchObject({
      firstHopBlacklistFacts: serialized.resultJson.firstHopBlacklistFacts,
      firstHopLabelFacts: serialized.resultJson.firstHopLabelFacts,
      firstHopBlacklistCoverage: serialized.resultJson.firstHopBlacklistCoverage
    });
    const restored = normalizePersistedDeepFirstHopEvidence(serialized.resultJson);
    expect(restored.firstHopBlacklistFacts).toEqual(serialized.resultJson.firstHopBlacklistFacts);
    expect(restored.firstHopLabelFacts).toEqual(serialized.resultJson.firstHopLabelFacts);
    expect(restored.firstHopBlacklistCoverage).toEqual(serialized.resultJson.firstHopBlacklistCoverage);
    expect(restored.directHardEvidenceSnapshots).toHaveLength(1);
    expect(restored.firstHopBlacklistCoverage?.incompleteReason).not.toBe("persisted_first_hop_evidence_invalid");
  });

  it("stores pending Deep delivery before completion without calling a direct sender", async () => {
    const transfersByAddress = new Map<string, RawTronscanTrc20Transfer[]>([
      [
        subject,
        [
          transfer({
            id: "tx-benign-delivery",
            from: "TOther1111111111111111111111111111111",
            to: subject,
            amountRaw: "1000000000",
            at: "2026-05-20T10:00:00.000Z"
          })
        ]
      ]
    ]);
    const completeForensicCheckJob = vi.fn(async (_input: Parameters<Parameters<typeof runSingleDeepForensicJobCycle>[0]["completeForensicCheckJob"]>[0]) => true);
    const buildJobResultPayload = vi.fn(async () => ({
      version: "telegram-message-payload-v1" as const,
      chatId: "42",
      text: "deep-result",
      parseMode: "HTML" as const,
      replyMarkup: null
    }));
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };

    const handled = await runSingleDeepForensicJobCycle({
      claimNextForensicCheckJob: async () => job(),
      completeForensicCheckJob,
      recordRiskEvaluation: vi.fn(async () => undefined),
      upsertAddressLabelAssertion: vi.fn(async (_input: AddressLabelAssertionInput) => undefined),
      tronClient: {
        listRelatedTrc20Transfers: async (address) => transfersByAddress.get(address) ?? []
      },
      getLabelsForAddress: async () => [],
      getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({ subjectAddress: address }),
      buildJobResultPayload,
      logger
    }, {
      pageLimit: 10,
      maxPagesPerAddress: 1,
      maxExpandedIntermediates: 0,
      metadataFetchLimit: 0,
      contractProfileFetchLimit: 0,
      maxInboundSenders: 1
    });

    expect(handled).toBe(true);
    expect(buildJobResultPayload).toHaveBeenCalledTimes(1);
    expect(completeForensicCheckJob).toHaveBeenCalledTimes(1);
    expect(completeForensicCheckJob.mock.calls[0][0]).toMatchObject({
      id: "job-1",
      lastError: null,
      progressJson: expect.objectContaining({
        telegramDelivery: expect.objectContaining({
          payload: expect.objectContaining({ chatId: "42", text: "deep-result" }),
          state: expect.objectContaining({ status: "pending", attemptCount: 0 }),
          claim: null
        })
      })
    });
    expect(completeForensicCheckJob.mock.calls[0][0].status).not.toBe("failed");
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("does not fail a completed deep job when wallet intelligence indexing fails", async () => {
    const completeForensicCheckJob = vi.fn(async () => true);
    const indexWalletIntelligenceJob = vi.fn(async () => {
      throw new Error("wallet intelligence unavailable");
    });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const handled = await runSingleDeepForensicJobCycle({
      claimNextForensicCheckJob: async () => job(),
      completeForensicCheckJob,
      indexWalletIntelligenceJob,
      recordRiskEvaluation: vi.fn(async () => undefined),
      upsertAddressLabelAssertion: vi.fn(async () => undefined),
      tronClient: { listRelatedTrc20Transfers: async () => [] },
      getLabelsForAddress: async () => [],
      getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({ subjectAddress: address }),
      logger
    }, {
      pageLimit: 1,
      maxPagesPerAddress: 1,
      maxExpandedIntermediates: 0,
      metadataFetchLimit: 0,
      contractProfileFetchLimit: 0,
      maxInboundSenders: 1
    });

    expect(handled).toBe(true);
    expect(completeForensicCheckJob).toHaveBeenCalledTimes(1);
    expect(indexWalletIntelligenceJob).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith("wallet_intelligence_index_failed", expect.objectContaining({
      job_id: "job-1",
      error: "wallet intelligence unavailable"
    }));
  });
});
