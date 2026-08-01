import { describe, expect, it, vi } from "vitest";
import type { WhereIsMoneyDeps } from "../../src/check/whereIsMoneyCheck";
import {
  createLegacyWhereIsMoneyExecution,
  type DeepForensicJobRunnerDeps
} from "../../src/forensics/deepForensicJob";
import { createCrossChainProviderBudget } from "../../src/forensics/crossChainBudget";
import type { DependencyInvocationRecorder } from "../../src/forensics/whereLatencyReplay";
import { recordWhereIsMoneyDependencies } from "../../src/forensics/whereLatencyReplay";
import type { ForensicCheckJob } from "../../src/storage/repositories";
import type { ForensicRouteEdge, StablecoinRestrictionProfile } from "../../src/types";

const SUBJECT = "TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd";

function restriction(address: string): StablecoinRestrictionProfile {
  return {
    subjectAddress: address,
    tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    tokenSymbol: "USDT",
    tokenStandard: "TRC20",
    decimals: 6,
    isBlacklisted: false,
    balanceRaw: "17",
    checkedAt: "2026-07-26T00:00:00.000Z",
    evidenceStrength: "exact_contract_state",
    blacklistEventTxHash: null,
    blacklistEventTimestamp: null,
    blacklistEventBlock: null,
    methods: { blacklist: "isBlackListed(address)", balance: "balanceOf(address)" }
  };
}

function legacyJob(): ForensicCheckJob {
  const now = new Date("2026-07-26T00:00:00.000Z");
  return {
    id: "where-replay-job",
    kind: "where_is_money_check",
    subjectAddress: SUBJECT,
    status: "running",
    windowStart: new Date("2026-01-01T00:00:00.000Z"),
    windowEnd: now,
    priority: 100,
    chatId: null,
    messageId: null,
    requestedBy: null,
    progressJson: {
      mode: "where_is_money",
      fastRiskSnapshot: {
        score: 23,
        level: "MEDIUM",
        reasons: [{ code: "snapshot", message: "saved", scoreImpact: 23 }]
      }
    },
    resultJson: {},
    rawEvidenceIds: [],
    observationIds: [],
    lastError: null,
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    completedAt: null
  };
}

function productionBaseDeps(): DeepForensicJobRunnerDeps {
  const continuationProvider = {
    chain: "tron",
    listEdgesForAddress: vi.fn(async () => [])
  };
  return {
    tronClient: { listRelatedTrc20Transfers: vi.fn(async () => []) },
    claimNextForensicCheckJob: vi.fn(async () => null),
    completeForensicCheckJob: vi.fn(async () => true),
    recordRiskEvaluation: vi.fn(async () => undefined),
    getLabelsForAddress: vi.fn(async () => []),
    getAddressMetadata: vi.fn(async () => null),
    getContractIntelligenceProfile: vi.fn(async () => null),
    getUsdtRestrictionStatus: vi.fn(async (address: string) => restriction(address)),
    getTransaction: vi.fn(async () => null),
    listTrc20ApprovalChanges: vi.fn(async () => []),
    listIndexedUsdtTransfersForAddress: vi.fn(async () => []),
    getAddressUsdtIndexState: vi.fn(async () => null),
    getCoveringAddressUsdtIndexState: vi.fn(async () => null),
    queueAddressUsdtHistory: vi.fn(async (
      _input: Parameters<NonNullable<DeepForensicJobRunnerDeps["queueAddressUsdtHistory"]>>[0]
    ) => { throw new Error("not invoked while constructing the graph"); }),
    releaseForensicCheckJobToWaiting: vi.fn(async () => true),
    crossChainDiscoveryProvider: {
      findTransfersByTx: vi.fn(async () => []),
      findTransfersByAddress: vi.fn(async () => []),
      getAddressRisk: vi.fn(async () => null)
    },
    crossChainContinuationProviders: [continuationProvider],
    evmEvidenceProvider: {
      listNormalTransactions: vi.fn(async () => []),
      listInternalTransactions: vi.fn(async () => []),
      listErc20Transfers: vi.fn(async () => []),
      getTransactionReceipt: vi.fn(async () => null),
      getLogs: vi.fn(async () => []),
      getTokenMetadata: vi.fn(async () => null)
    }
  };
}

const COMPLETE_SURFACE = [
  "crossChainContinuationProviders",
  "crossChainDiscoveryProvider",
  "ensureBroadTargetedHistories",
  "ensureBroadTargetedHistory",
  "evmEvidenceProvider",
  "fetchEdgesForAddress",
  "fetchLatestEdgesForAddress",
  "getClassificationForAddress",
  "getContractIntelligenceProfile",
  "getFastWalletRisk",
  "getHistoryCoverageForAddress",
  "getLabelsForAddress",
  "getTransaction",
  "getTrc20Balance",
  "getUsdtRestrictionStatus",
  "listTrc20ApprovalChanges",
  "repairSourceProvenanceWindow",
  "requestCandidateWindows"
] as const;

describe("legacy Where production dependency graph", () => {
  it("constructs the complete production surface once and exposes the job-bound fast-risk snapshot", async () => {
    const execution = createLegacyWhereIsMoneyExecution(productionBaseDeps(), legacyJob(), {});
    const recordedCalls: Array<{ method: string; response: unknown }> = [];
    const recorded = recordWhereIsMoneyDependencies(execution.dependencies, async (method, _args, operation) => {
      const response = await operation();
      recordedCalls.push({ method, response });
      return response;
    });

    expect(Object.keys(execution.dependencies).sort()).toEqual(COMPLETE_SURFACE);
    expect(Object.keys(recorded).sort()).toEqual(Object.keys(execution.dependencies).sort());
    await expect(recorded.getFastWalletRisk?.(SUBJECT)).resolves.toEqual({
      subjectAddress: SUBJECT,
      score: 23,
      level: "MEDIUM",
      reasons: [{ code: "snapshot", message: "saved", scoreImpact: 23 }]
    });
    expect(recordedCalls).toEqual([{
      method: "getFastWalletRisk",
      response: {
        subjectAddress: SUBJECT,
        score: 23,
        level: "MEDIUM",
        reasons: [{ code: "snapshot", message: "saved", scoreImpact: 23 }]
      }
    }]);
  });

  it("recursively records the same surface and forwards exact arguments and responses", async () => {
    const targetEdge: ForensicRouteEdge = {
      id: "target-edge",
      txHash: "target-tx",
      fromAddress: "TFrom1111111111111111111111111111111",
      toAddress: SUBJECT,
      amountRaw: "17",
      timestamp: new Date("2026-07-25T12:00:00.000Z"),
      method: "transfer",
      edgeType: "normal_transfer"
    };
    const fetchOptions = {
      latestTimestamp: new Date("2026-07-25T12:00:00.000Z"),
      deferBroadTargetedHistory: true,
      targetEdge,
      expectedAmountRaw: "17"
    };
    const repairInput = {
      address: targetEdge.fromAddress,
      target: targetEdge,
      sourceProvenance: {
        mode: "source_provenance" as const,
        targetTxHash: targetEdge.txHash,
        targetFromAddress: targetEdge.fromAddress,
        targetToAddress: targetEdge.toAddress,
        targetTimestamp: targetEdge.timestamp.toISOString(),
        targetAmountRaw: targetEdge.amountRaw,
        proofClass: "unresolved" as const,
        coveredAmountRaw: "0",
        coverageRatio: 0,
        amountContinuity: "broken" as const,
        stopReason: null,
        fundingBundle: null,
        coverageWindow: {
          startTimestamp: null,
          endTimestamp: targetEdge.timestamp.toISOString(),
          complete: false,
          capped: false,
          providerInconsistent: false
        },
        reasons: []
      },
      windowStart: new Date("2026-07-24T00:00:00.000Z"),
      windowEnd: new Date("2026-07-25T12:00:00.000Z"),
      downstreamAmountRaw: "17",
      minCoverageRatio: 0.95,
      maxFunders: 8
    };
    const candidateRequests = [{
      address: targetEdge.fromAddress,
      targetTimestamp: targetEdge.timestamp,
      windowStartTimestamp: repairInput.windowStart,
      windowEndTimestamp: repairInput.windowEnd,
      candidateTxHash: targetEdge.txHash,
      relatedHopTxHash: targetEdge.txHash,
      requestedAmountRaw: "17",
      candidateAmountRaw: "17",
      coverageShare: 1
    }];
    const broadRequest = {
      address: targetEdge.fromAddress,
      targetTimestamp: targetEdge.timestamp,
      queuedReason: "where_is_money_hop" as const,
      reason: "material_unresolved_after_candidate_windows" as const
    };
    const calls: Array<{ method: string; args: unknown[]; response: unknown }> = [];
    const recorder: DependencyInvocationRecorder = async (method, args, operation) => {
      const response = await operation();
      calls.push({ method, args, response });
      return response;
    };
    const original: WhereIsMoneyDeps = {
      getTrc20Balance: vi.fn(async () => "17"),
      fetchEdgesForAddress: vi.fn(async () => [targetEdge]),
      getHistoryCoverageForAddress: vi.fn(async () => ({
        address: SUBJECT,
        targetTimestamp: targetEdge.timestamp.toISOString(),
        fetchedTransferCount: 1,
        oldestFetchedTransferAt: targetEdge.timestamp.toISOString(),
        reachedTargetHop: true,
        source: "local_index" as const
      })),
      repairSourceProvenanceWindow: vi.fn(async () => null),
      requestCandidateWindows: vi.fn(async () => true as const),
      ensureBroadTargetedHistory: vi.fn(async () => true as const),
      ensureBroadTargetedHistories: vi.fn(async () => true as const),
      fetchLatestEdgesForAddress: vi.fn(async () => [targetEdge]),
      getLabelsForAddress: vi.fn(async () => []),
      getClassificationForAddress: vi.fn(async () => null),
      getFastWalletRisk: vi.fn(async () => ({ subjectAddress: SUBJECT, score: 23, level: "MEDIUM" as const, reasons: [] })),
      getTransaction: vi.fn(async () => ({ txID: targetEdge.txHash })),
      listTrc20ApprovalChanges: vi.fn(async () => []),
      getUsdtRestrictionStatus: vi.fn(async () => restriction(SUBJECT)),
      getContractIntelligenceProfile: vi.fn(async () => null),
      crossChainDiscoveryProvider: {
        findTransfersByTx: vi.fn(async () => []),
        findTransfersByAddress: vi.fn(async () => []),
        getAddressRisk: vi.fn(async () => null)
      },
      crossChainContinuationProviders: [{ chain: "tron", listEdgesForAddress: vi.fn(async () => []) }],
      evmEvidenceProvider: {
        listNormalTransactions: vi.fn(async () => []),
        listInternalTransactions: vi.fn(async () => []),
        listErc20Transfers: vi.fn(async () => []),
        getTransactionReceipt: vi.fn(async () => null),
        getLogs: vi.fn(async () => []),
        getTokenMetadata: vi.fn(async () => null)
      }
    };
    const recorded = recordWhereIsMoneyDependencies(original, recorder);

    expect(Object.keys(recorded).sort()).toEqual(Object.keys(original).sort());
    await expect(recorded.fetchEdgesForAddress(SUBJECT, fetchOptions)).resolves.toEqual([targetEdge]);
    await recorded.getHistoryCoverageForAddress?.(SUBJECT, fetchOptions);
    await recorded.repairSourceProvenanceWindow?.(repairInput);
    await recorded.requestCandidateWindows?.(candidateRequests);
    await recorded.ensureBroadTargetedHistory?.(broadRequest);
    await recorded.ensureBroadTargetedHistories?.([broadRequest]);
    await recorded.getFastWalletRisk?.(SUBJECT);
    await recorded.crossChainDiscoveryProvider?.findTransfersByTx({ chain: "tron", txHash: targetEdge.txHash });
    await recorded.crossChainContinuationProviders?.[0]?.listEdgesForAddress({
      address: { chain: "tron", chainId: "tron", address: SUBJECT },
      seed: {
        id: "seed",
        chain: "tron",
        address: SUBJECT,
        txHash: targetEdge.txHash,
        amountRaw: "17",
        assetSymbol: "USDT",
        timestamp: targetEdge.timestamp.toISOString(),
        labels: [],
        evidenceRefs: []
      },
      budget: createCrossChainProviderBudget({ maxProviderCalls: 1 })
    });
    await recorded.evmEvidenceProvider?.listNormalTransactions({ chain: "ethereum", address: "0xabc" });

    expect(calls.map(({ method }) => method)).toEqual([
      "fetchEdgesForAddress",
      "getHistoryCoverageForAddress",
      "repairSourceProvenanceWindow",
      "requestCandidateWindows",
      "ensureBroadTargetedHistory",
      "ensureBroadTargetedHistories",
      "getFastWalletRisk",
      "crossChainDiscoveryProvider.findTransfersByTx",
      "crossChainContinuationProviders.0.listEdgesForAddress",
      "evmEvidenceProvider.listNormalTransactions"
    ]);
    expect(calls[0]?.args).toEqual([SUBJECT, fetchOptions]);
    expect(calls[0]?.args[1]).toBe(fetchOptions);
    expect(calls[1]?.args).toEqual([SUBJECT, fetchOptions]);
    expect(calls[2]?.args).toEqual([repairInput]);
    expect(calls[3]?.args).toEqual([candidateRequests]);
    expect(calls[4]?.args).toEqual([broadRequest]);
    expect(calls[5]?.args).toEqual([[broadRequest]]);
    expect(calls[6]?.response).toMatchObject({ subjectAddress: SUBJECT, score: 23 });
  });

  it("keeps optional dependencies absent", () => {
    const minimal: WhereIsMoneyDeps = {
      getTrc20Balance: vi.fn(async () => null),
      fetchEdgesForAddress: vi.fn(async () => []),
      getLabelsForAddress: vi.fn(async () => []),
      getClassificationForAddress: vi.fn(async () => null)
    };

    expect(Object.keys(recordWhereIsMoneyDependencies(minimal, async (_method, _args, operation) => operation())).sort())
      .toEqual(Object.keys(minimal).sort());
  });
});
