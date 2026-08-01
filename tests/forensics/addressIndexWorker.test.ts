import { describe, expect, it, vi } from "vitest";
import { runAddressIndexWorkerOnce } from "../../src/forensics/addressIndexWorker";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser";
import type { TronAddressUsdtIndexState } from "../../src/types";

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
    queuedReason: "background_index",
    requestedByJobId: null,
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

function candidateWindowWorkerState(address: string): TronAddressUsdtIndexState {
  const targetTimestamp = new Date("2026-07-04T12:00:00.000Z");
  return {
    address,
    tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    coverageMode: "targeted",
    coverageKind: "provider_windowed",
    requestKind: "candidate_window",
    status: "queued",
    statusReason: null,
    provider: null,
    totalReported: null,
    fetchedTransferCount: 0,
    uniqueCounterpartyCount: 0,
    newestTransferAt: null,
    oldestTransferAt: null,
    coveredUntilTimestamp: null,
    targetTimestamp,
    windowStartTimestamp: new Date("2026-07-04T11:55:00.000Z"),
    windowEndTimestamp: targetTimestamp,
    relatedHopTxHash: "hop-tx-1",
    candidateTxHash: "candidate-tx-1",
    fetchedPageCount: 0,
    plannedPageCount: null,
    currentEndTimestamp: null,
    providerCapHit: false,
    budgetExhausted: false,
    providerInconsistent: false,
    priority: 240,
    nextRunAt: targetTimestamp,
    attemptCount: 0,
    maxAttempts: 3,
    retryCount: 0,
    lastError: null,
    lastErrorClass: null,
    lastSuccessfulPageAt: null,
    queuedReason: "where_candidate_window",
    requestedByJobId: "where-job-1",
    lockedAt: null,
    lockedUntil: null,
    heartbeatAt: null,
    lockOwner: null,
    budgetPages: 200,
    budgetSeconds: null,
    completedAt: null,
    createdAt: targetTimestamp,
    updatedAt: targetTimestamp
  };
}

describe("runAddressIndexWorkerOnce", () => {
  it("claims queued address index states and indexes them by coverage key", async () => {
    const claimed = [
      queuedIndexState("TDirect111111111111111111111111111111"),
      {
        ...queuedIndexState("THop11111111111111111111111111111111"),
        coverageMode: "targeted" as const,
        targetTimestamp: new Date("2026-06-14T15:05:15.000Z")
      }
    ];
    const ensured: string[] = [];

    await runAddressIndexWorkerOnce({
      claimQueuedTronAddressUsdtIndexStates: async () => claimed,
      ensureAddressUsdtHistory: async (input) => {
        ensured.push(`${input.address}:${input.coverageMode}:${input.targetTimestamp?.getTime() ?? 0}`);
        return {
          ...claimed[0],
          address: input.address,
          coverageMode: input.coverageMode,
          targetTimestamp: input.targetTimestamp ?? null,
          status: "complete"
        };
      },
      failTronAddressUsdtIndexState: async () => undefined
    }, {
      claimLimit: 2,
      lockMs: 600_000,
      workerId: "worker-a"
    });

    expect(ensured).toEqual([
      "TDirect111111111111111111111111111111:all_time:0",
      "THop11111111111111111111111111111111:targeted:1781449515000"
    ]);
  });

  it("claims queued states with the existing safe default worker filter", async () => {
    const claimQueuedTronAddressUsdtIndexStates = vi.fn(async () => []);

    await runAddressIndexWorkerOnce({
      claimQueuedTronAddressUsdtIndexStates,
      ensureAddressUsdtHistory: async () => queuedIndexState("TDirect111111111111111111111111111111"),
      failTronAddressUsdtIndexState: async () => undefined
    }, {
      claimLimit: 2,
      lockMs: 600_000,
      workerId: "worker-a"
    });

    expect(claimQueuedTronAddressUsdtIndexStates).toHaveBeenCalledWith({
      limit: 2,
      lockOwner: "worker-a",
      lockMs: 600_000
    });
  });

  it("marks failed states with classified provider errors", async () => {
    const failures: unknown[] = [];

    await runAddressIndexWorkerOnce({
      claimQueuedTronAddressUsdtIndexStates: async () => [queuedIndexState("TDirect111111111111111111111111111111")],
      ensureAddressUsdtHistory: async () => {
        throw new Error("429 too many requests");
      },
      failTronAddressUsdtIndexState: async (input) => {
        failures.push(input);
      }
    }, {
      claimLimit: 1,
      lockMs: 600_000,
      workerId: "worker-a"
    });

    expect(failures).toEqual([
      expect.objectContaining({
        address: "TDirect111111111111111111111111111111",
        coverageMode: "all_time",
        targetTimestamp: null,
        error: "429 too many requests",
        errorClass: "rate_limited"
      })
    ]);
  });

  it("marks requested targeted strict jobs ready after successful indexing", async () => {
    const targetTimestamp = new Date("2026-06-14T15:05:15.000Z");
    const markStrictProvenanceJobReadyAfterIndex = vi.fn(async () => true);
    const targetedState = {
      ...queuedIndexState("THop11111111111111111111111111111111"),
      coverageMode: "targeted" as const,
      targetTimestamp,
      requestedByJobId: "job-where-1",
      queuedReason: "where_is_money_hop"
    };

    await runAddressIndexWorkerOnce({
      claimQueuedTronAddressUsdtIndexStates: async () => [targetedState],
      ensureAddressUsdtHistory: async () => ({
        ...targetedState,
        status: "complete",
        statusReason: "complete_provider_windowed",
        lastError: null
      }),
      failTronAddressUsdtIndexState: async () => undefined,
      markStrictProvenanceJobReadyAfterIndex
    }, {
      claimLimit: 1,
      lockMs: 600_000,
      workerId: "worker-a"
    });

    expect(markStrictProvenanceJobReadyAfterIndex).toHaveBeenCalledWith({
      id: "job-where-1",
      address: "THop11111111111111111111111111111111",
      targetTimestamp,
      indexStatus: "complete",
      statusReason: "complete_provider_windowed",
      lastError: null
    });
  });

  it("marks generic targeted waiters ready after successful indexing", async () => {
    const targetTimestamp = new Date("2026-06-14T15:05:15.000Z");
    const markWaitingForensicJobsReadyAfterTargetedIndex = vi.fn(async () => 2);
    const targetedState = {
      ...queuedIndexState("THop11111111111111111111111111111111"),
      coverageMode: "targeted" as const,
      targetTimestamp,
      requestedByJobId: null,
      queuedReason: "where_is_money_hop",
      budgetPages: 200
    };
    const ensureAddressUsdtHistory = vi.fn(async () => ({
      ...targetedState,
      status: "complete" as const,
      statusReason: "complete_provider_windowed" as const,
      lastError: null
    }));

    await runAddressIndexWorkerOnce({
      claimQueuedTronAddressUsdtIndexStates: async () => [targetedState],
      ensureAddressUsdtHistory,
      failTronAddressUsdtIndexState: async () => undefined,
      markWaitingForensicJobsReadyAfterTargetedIndex
    }, {
      claimLimit: 1,
      lockMs: 600_000,
      workerId: "worker-a"
    });

    expect(ensureAddressUsdtHistory).toHaveBeenCalledWith(expect.objectContaining({
      maxPagesPerRun: 200
    }));
    expect(markWaitingForensicJobsReadyAfterTargetedIndex).toHaveBeenCalledWith({
      address: "THop11111111111111111111111111111111",
      targetTimestamp,
      indexStatus: "complete",
      statusReason: "complete_provider_windowed",
      lastError: null,
      state: expect.objectContaining({
        status: "complete",
        statusReason: "complete_provider_windowed"
      })
    });
  });

  it("reconciles the full wait set only after the targeted child wait update finishes", async () => {
    const targetTimestamp = new Date("2026-06-14T15:05:15.000Z");
    const targetedState = {
      ...queuedIndexState("THopReconcile1111111111111111111111111"),
      coverageMode: "targeted" as const,
      targetTimestamp,
      requestedByJobId: null,
      queuedReason: "where_is_money_hop",
      budgetPages: 200
    };
    const order: string[] = [];
    let finishWaitUpdate!: () => void;
    const waitUpdateFinished = new Promise<void>((resolve) => { finishWaitUpdate = resolve; });
    const deps = {
      claimQueuedTronAddressUsdtIndexStates: async () => [targetedState],
      ensureAddressUsdtHistory: async () => ({
        ...targetedState,
        status: "complete" as const,
        statusReason: "complete_provider_windowed" as const,
        lastError: null
      }),
      failTronAddressUsdtIndexState: async () => undefined,
      markWaitingForensicJobsReadyAfterTargetedIndex: async () => {
        order.push("wait-update-started");
        await waitUpdateFinished;
        order.push("wait-update-finished");
        return 1;
      },
      reconcileWaitingForensicJobs: async () => { order.push("reconciled"); }
    };

    const cycle = runAddressIndexWorkerOnce(deps, {
      claimLimit: 1,
      lockMs: 600_000,
      workerId: "worker-a"
    });
    await vi.waitFor(() => expect(order).toEqual(["wait-update-started"]));
    finishWaitUpdate();
    await cycle;

    expect(order).toEqual(["wait-update-started", "wait-update-finished", "reconciled"]);
  });

  it("does not rewrite successful index or strict state when post-index reconciliation rejects", async () => {
    const targetTimestamp = new Date("2026-06-14T15:05:15.000Z");
    const targetedState = {
      ...queuedIndexState("THopReconcileFailure111111111111111111111"),
      coverageMode: "targeted" as const,
      targetTimestamp,
      requestedByJobId: "job-where-reconcile-failure",
      queuedReason: "where_is_money_hop",
      budgetPages: 200
    };
    const failTronAddressUsdtIndexState = vi.fn(async () => undefined);
    const markWaitingForensicJobsReadyAfterTargetedIndex = vi.fn(async () => 1);
    const markStrictProvenanceJobReadyAfterIndex = vi.fn(async () => true);
    const onWaitReconciliationError = vi.fn(() => undefined);
    const deps = {
      claimQueuedTronAddressUsdtIndexStates: async () => [targetedState],
      ensureAddressUsdtHistory: async () => ({
        ...targetedState,
        status: "complete" as const,
        statusReason: "complete_provider_windowed" as const,
        lastError: null
      }),
      failTronAddressUsdtIndexState,
      markWaitingForensicJobsReadyAfterTargetedIndex,
      reconcileWaitingForensicJobs: async () => { throw new Error("reconciliation unavailable"); },
      onWaitReconciliationError,
      markStrictProvenanceJobReadyAfterIndex
    };

    await runAddressIndexWorkerOnce(deps, {
      claimLimit: 1,
      lockMs: 600_000,
      workerId: "worker-a"
    });

    expect(failTronAddressUsdtIndexState).not.toHaveBeenCalled();
    expect(markWaitingForensicJobsReadyAfterTargetedIndex).toHaveBeenCalledTimes(1);
    expect(markWaitingForensicJobsReadyAfterTargetedIndex).toHaveBeenCalledWith(expect.objectContaining({
      indexStatus: "complete",
      statusReason: "complete_provider_windowed",
      lastError: null
    }));
    expect(markStrictProvenanceJobReadyAfterIndex).toHaveBeenCalledTimes(1);
    expect(markStrictProvenanceJobReadyAfterIndex).toHaveBeenCalledWith(expect.objectContaining({
      indexStatus: "complete",
      statusReason: "complete_provider_windowed",
      lastError: null
    }));
    expect(onWaitReconciliationError).toHaveBeenCalledOnce();
    expect(onWaitReconciliationError).toHaveBeenCalledWith();
  });

  it("contains a throwing reconciliation diagnostic without corrupting successful index state", async () => {
    const targetTimestamp = new Date("2026-06-14T15:05:15.000Z");
    const targetedState = {
      ...queuedIndexState("THopReconcileDiagnostic11111111111111111111"),
      coverageMode: "targeted" as const,
      targetTimestamp,
      requestedByJobId: "job-where-reconcile-diagnostic",
      queuedReason: "where_is_money_hop",
      budgetPages: 200
    };
    const failTronAddressUsdtIndexState = vi.fn(async () => undefined);
    const markWaitingForensicJobsReadyAfterTargetedIndex = vi.fn(async () => 1);
    const markStrictProvenanceJobReadyAfterIndex = vi.fn(async () => true);
    const onWaitReconciliationError = vi.fn(() => { throw new Error("diagnostic sink unavailable"); });

    await runAddressIndexWorkerOnce({
      claimQueuedTronAddressUsdtIndexStates: async () => [targetedState],
      ensureAddressUsdtHistory: async () => ({
        ...targetedState,
        status: "complete" as const,
        statusReason: "complete_provider_windowed" as const,
        lastError: null
      }),
      failTronAddressUsdtIndexState,
      markWaitingForensicJobsReadyAfterTargetedIndex,
      reconcileWaitingForensicJobs: async () => { throw new Error("reconciliation unavailable"); },
      onWaitReconciliationError,
      markStrictProvenanceJobReadyAfterIndex
    }, {
      claimLimit: 1,
      lockMs: 600_000,
      workerId: "worker-a"
    });

    expect(onWaitReconciliationError).toHaveBeenCalledOnce();
    expect(failTronAddressUsdtIndexState).not.toHaveBeenCalled();
    expect(markWaitingForensicJobsReadyAfterTargetedIndex).toHaveBeenCalledTimes(1);
    expect(markWaitingForensicJobsReadyAfterTargetedIndex).toHaveBeenCalledWith(expect.objectContaining({
      indexStatus: "complete",
      statusReason: "complete_provider_windowed",
      lastError: null
    }));
    expect(markStrictProvenanceJobReadyAfterIndex).toHaveBeenCalledTimes(1);
    expect(markStrictProvenanceJobReadyAfterIndex).toHaveBeenCalledWith(expect.objectContaining({
      indexStatus: "complete",
      statusReason: "complete_provider_windowed",
      lastError: null
    }));
  });

  it("passes candidate-window identity and caps page budget to the indexer", async () => {
    const state = candidateWindowWorkerState("TWorkerWindow111111111111111111111111");
    const calls: unknown[] = [];
    const markWaitingForensicJobsReadyAfterTargetedIndex = vi.fn(async () => 1);

    await runAddressIndexWorkerOnce({
      claimQueuedTronAddressUsdtIndexStates: async () => [state],
      ensureAddressUsdtHistory: async (input) => {
        calls.push(input);
        return { ...state, status: "complete", statusReason: "complete_provider_windowed" };
      },
      failTronAddressUsdtIndexState: async () => undefined,
      markWaitingForensicJobsReadyAfterTargetedIndex,
      patchWaitingForensicJobsTargetedIndexProgress: async () => 0
    }, {
      claimLimit: 1,
      lockMs: 60_000,
      workerId: "worker-test",
      targetedRetry: { basePages: 200, maxPagesPerHop: 12_000, maxAttempts: 8, retryDelayMs: 30_000 }
    });

    expect(calls[0]).toMatchObject({
      requestKind: "candidate_window",
      windowStartTimestamp: state.windowStartTimestamp,
      windowEndTimestamp: state.windowEndTimestamp,
      relatedHopTxHash: "hop-tx-1",
      candidateTxHash: "candidate-tx-1",
      maxPagesPerRun: 200
    });
    expect(markWaitingForensicJobsReadyAfterTargetedIndex).toHaveBeenCalledWith(expect.objectContaining({
      address: state.address,
      requestKind: "candidate_window",
      targetTimestamp: state.targetTimestamp,
      windowStartTimestamp: state.windowStartTimestamp,
      windowEndTimestamp: state.windowEndTimestamp,
      relatedHopTxHash: "hop-tx-1",
      candidateTxHash: "candidate-tx-1",
      indexStatus: "complete",
      statusReason: "complete_provider_windowed"
    }));
  });

  it("marks candidate-window waits terminal with exact identity after terminal indexing failure", async () => {
    const state = {
      ...candidateWindowWorkerState("TWorkerWindowFail11111111111111111111"),
      attemptCount: 3,
      maxAttempts: 3
    };
    const markWaitingForensicJobsReadyAfterTargetedIndex = vi.fn(async () => 1);
    const failTronAddressUsdtIndexState = vi.fn(async () => undefined);

    await runAddressIndexWorkerOnce({
      claimQueuedTronAddressUsdtIndexStates: async () => [state],
      ensureAddressUsdtHistory: async () => {
        throw new Error("provider inconsistent");
      },
      failTronAddressUsdtIndexState,
      markWaitingForensicJobsReadyAfterTargetedIndex,
      patchWaitingForensicJobsTargetedIndexProgress: async () => 0
    }, {
      claimLimit: 1,
      lockMs: 60_000,
      workerId: "worker-test",
      targetedRetry: { basePages: 200, maxPagesPerHop: 12_000, maxAttempts: 1, retryDelayMs: 30_000 }
    });

    expect(failTronAddressUsdtIndexState).toHaveBeenCalledWith(expect.objectContaining({
      requestKind: "candidate_window",
      windowStartTimestamp: state.windowStartTimestamp,
      windowEndTimestamp: state.windowEndTimestamp,
      relatedHopTxHash: "hop-tx-1",
      candidateTxHash: "candidate-tx-1"
    }));
    expect(markWaitingForensicJobsReadyAfterTargetedIndex).toHaveBeenCalledWith(expect.objectContaining({
      address: state.address,
      requestKind: "candidate_window",
      targetTimestamp: state.targetTimestamp,
      windowStartTimestamp: state.windowStartTimestamp,
      windowEndTimestamp: state.windowEndTimestamp,
      relatedHopTxHash: "hop-tx-1",
      candidateTxHash: "candidate-tx-1",
      indexStatus: "failed_terminal",
      statusReason: "partial_provider_inconsistent",
      lastError: "provider inconsistent"
    }));
  });

  it("keeps retryable candidate-window failures waiting with exact progress identity", async () => {
    const state = candidateWindowWorkerState("TWorkerWindowRetry111111111111111111");
    const patchWaitingForensicJobsTargetedIndexProgress = vi.fn(async () => 1);
    const markWaitingForensicJobsReadyAfterTargetedIndex = vi.fn(async () => 1);

    await runAddressIndexWorkerOnce({
      claimQueuedTronAddressUsdtIndexStates: async () => [state],
      ensureAddressUsdtHistory: async () => {
        throw new Error("provider inconsistent");
      },
      failTronAddressUsdtIndexState: async () => undefined,
      markWaitingForensicJobsReadyAfterTargetedIndex,
      patchWaitingForensicJobsTargetedIndexProgress
    }, {
      claimLimit: 1,
      lockMs: 60_000,
      workerId: "worker-test",
      targetedRetry: { basePages: 200, maxPagesPerHop: 12_000, maxAttempts: 3, retryDelayMs: 30_000 }
    });

    expect(patchWaitingForensicJobsTargetedIndexProgress).toHaveBeenCalledWith(expect.objectContaining({
      address: state.address,
      requestKind: "candidate_window",
      targetTimestamp: state.targetTimestamp,
      windowStartTimestamp: state.windowStartTimestamp,
      windowEndTimestamp: state.windowEndTimestamp,
      relatedHopTxHash: "hop-tx-1",
      candidateTxHash: "candidate-tx-1",
      indexStatus: "failed_retryable",
      statusReason: "partial_provider_inconsistent",
      lastError: "provider inconsistent"
    }));
    expect(markWaitingForensicJobsReadyAfterTargetedIndex).toHaveBeenCalledWith(expect.objectContaining({
      address: state.address,
      requestKind: "candidate_window",
      targetTimestamp: state.targetTimestamp,
      windowStartTimestamp: state.windowStartTimestamp,
      windowEndTimestamp: state.windowEndTimestamp,
      relatedHopTxHash: "hop-tx-1",
      candidateTxHash: "candidate-tx-1",
      indexStatus: "failed_retryable",
      statusReason: "partial_provider_inconsistent",
      lastError: "provider inconsistent"
    }));
  });

  it("passes lock owner and lock window into targeted ensure calls for heartbeat extension", async () => {
    const targetTimestamp = new Date("2026-06-14T15:05:15.000Z");
    const targetedState = {
      ...queuedIndexState("THop11111111111111111111111111111111"),
      coverageMode: "targeted" as const,
      targetTimestamp,
      queuedReason: "where_is_money_hop",
      budgetPages: 200
    };
    const ensureAddressUsdtHistory = vi.fn(async (input) => ({
      ...targetedState,
      address: input.address,
      coverageMode: input.coverageMode,
      targetTimestamp: input.targetTimestamp ?? null,
      status: "complete" as const,
      statusReason: "complete_provider_windowed" as const
    }));

    await runAddressIndexWorkerOnce({
      claimQueuedTronAddressUsdtIndexStates: async () => [targetedState],
      ensureAddressUsdtHistory,
      failTronAddressUsdtIndexState: async () => undefined
    }, {
      claimLimit: 1,
      lockMs: 600_000,
      workerId: "worker-a"
    });

    expect(ensureAddressUsdtHistory).toHaveBeenCalledWith(expect.objectContaining({
      lockOwner: "worker-a",
      lockMs: 600_000
    }));
  });

  it("requeues targeted budget partials with a larger budget instead of waking waiters", async () => {
    const targetTimestamp = new Date("2026-06-14T15:05:15.000Z");
    const markWaitingForensicJobsReadyAfterTargetedIndex = vi.fn(async () => 2);
    const patchWaitingForensicJobsTargetedIndexProgress = vi.fn(async () => 2);
    const queueAddressUsdtHistory = vi.fn(async (input) => ({
      ...queuedIndexState(input.address),
      coverageMode: "targeted" as const,
      targetTimestamp: input.targetTimestamp ?? null,
      queuedReason: input.queuedReason,
      budgetPages: input.budgetPages ?? null,
      maxAttempts: input.maxAttempts ?? 5,
      fetchedPageCount: 200,
      fetchedTransferCount: 150
    }));
    const targetedState = {
      ...queuedIndexState("THop11111111111111111111111111111111"),
      coverageMode: "targeted" as const,
      targetTimestamp,
      requestedByJobId: "job-where-1",
      queuedReason: "where_is_money_hop",
      budgetPages: 200,
      attemptCount: 1,
      maxAttempts: 8
    };

    await runAddressIndexWorkerOnce({
      claimQueuedTronAddressUsdtIndexStates: async () => [targetedState],
      ensureAddressUsdtHistory: async () => ({
        ...targetedState,
        status: "partial" as const,
        statusReason: "partial_budget_exhausted" as const,
        fetchedPageCount: 200,
        fetchedTransferCount: 150
      }),
      queueAddressUsdtHistory,
      failTronAddressUsdtIndexState: async () => undefined,
      markWaitingForensicJobsReadyAfterTargetedIndex,
      patchWaitingForensicJobsTargetedIndexProgress
    }, {
      claimLimit: 1,
      lockMs: 600_000,
      workerId: "worker-a",
      targetedRetry: {
        basePages: 200,
        maxPagesPerHop: 2000,
        escalationFactor: 2,
        maxAttempts: 8
      }
    });

    expect(queueAddressUsdtHistory).toHaveBeenCalledWith(expect.objectContaining({
      address: "THop11111111111111111111111111111111",
      coverageMode: "targeted",
      targetTimestamp,
      requestedByJobId: "job-where-1",
      queuedReason: "where_is_money_hop",
      budgetPages: 400,
      maxAttempts: 8
    }));
    expect(patchWaitingForensicJobsTargetedIndexProgress).toHaveBeenCalledWith({
      address: "THop11111111111111111111111111111111",
      targetTimestamp,
      indexStatus: "queued",
      statusReason: "partial_budget_exhausted",
      lastError: null,
      state: expect.objectContaining({
        budgetPages: 400,
        fetchedPageCount: 200,
        fetchedTransferCount: 150
      })
    });
    expect(markWaitingForensicJobsReadyAfterTargetedIndex).not.toHaveBeenCalled();
  });

  it("escalates targeted provider-cap partials when the page budget was exhausted", async () => {
    const targetTimestamp = new Date("2026-06-14T15:05:15.000Z");
    const markWaitingForensicJobsReadyAfterTargetedIndex = vi.fn(async () => 2);
    const patchWaitingForensicJobsTargetedIndexProgress = vi.fn(async () => 2);
    const queueAddressUsdtHistory = vi.fn(async (input) => ({
      ...queuedIndexState(input.address),
      coverageMode: "targeted" as const,
      targetTimestamp: input.targetTimestamp ?? null,
      queuedReason: input.queuedReason,
      budgetPages: input.budgetPages ?? null,
      maxAttempts: input.maxAttempts ?? 5,
      fetchedPageCount: 200,
      fetchedTransferCount: 3900,
      providerCapHit: true,
      budgetExhausted: true
    }));
    const targetedState = {
      ...queuedIndexState("THop11111111111111111111111111111111"),
      coverageMode: "targeted" as const,
      targetTimestamp,
      requestedByJobId: "job-where-1",
      queuedReason: "where_is_money_hop",
      budgetPages: 200,
      attemptCount: 8,
      maxAttempts: 8
    };

    await runAddressIndexWorkerOnce({
      claimQueuedTronAddressUsdtIndexStates: async () => [targetedState],
      ensureAddressUsdtHistory: async () => ({
        ...targetedState,
        status: "partial" as const,
        statusReason: "partial_provider_cap" as const,
        fetchedPageCount: 200,
        fetchedTransferCount: 3900,
        providerCapHit: true,
        budgetExhausted: true
      }),
      queueAddressUsdtHistory,
      failTronAddressUsdtIndexState: async () => undefined,
      markWaitingForensicJobsReadyAfterTargetedIndex,
      patchWaitingForensicJobsTargetedIndexProgress
    }, {
      claimLimit: 1,
      lockMs: 600_000,
      workerId: "worker-a",
      targetedRetry: {
        basePages: 200,
        maxPagesPerHop: 2000,
        escalationFactor: 2,
        maxAttempts: 8
      }
    });

    expect(queueAddressUsdtHistory).toHaveBeenCalledWith(expect.objectContaining({
      budgetPages: 400,
      maxAttempts: 9
    }));
    expect(patchWaitingForensicJobsTargetedIndexProgress).toHaveBeenCalledWith(expect.objectContaining({
      indexStatus: "queued",
      statusReason: "partial_provider_cap",
      state: expect.objectContaining({
        budgetPages: 400,
        maxAttempts: 9,
        providerCapHit: true,
        budgetExhausted: true
      })
    }));
    expect(markWaitingForensicJobsReadyAfterTargetedIndex).not.toHaveBeenCalled();
  });

  it("requeues stale running targeted budget-exhausted states with a larger budget before replaying old windows", async () => {
    const targetTimestamp = new Date("2026-07-01T12:59:30.000Z");
    const markWaitingForensicJobsReadyAfterTargetedIndex = vi.fn(async () => 2);
    const patchWaitingForensicJobsTargetedIndexProgress = vi.fn(async () => 2);
    const ensureAddressUsdtHistory = vi.fn(async () => {
      throw new Error("stale budget-exhausted state should be requeued before ensure");
    });
    const queueAddressUsdtHistory = vi.fn(async (input) => ({
      ...queuedIndexState(input.address),
      coverageMode: "targeted" as const,
      targetTimestamp: input.targetTimestamp ?? null,
      queuedReason: input.queuedReason,
      requestedByJobId: input.requestedByJobId ?? null,
      budgetPages: input.budgetPages ?? null,
      maxAttempts: input.maxAttempts ?? 5,
      fetchedPageCount: 1600,
      fetchedTransferCount: 66404,
      providerCapHit: true,
      budgetExhausted: true
    }));
    const staleRunningState = {
      ...queuedIndexState("THop11111111111111111111111111111111"),
      coverageMode: "targeted" as const,
      targetTimestamp,
      requestedByJobId: "job-where-1",
      queuedReason: "where_is_money_hop",
      status: "running" as const,
      statusReason: null,
      budgetPages: 2000,
      attemptCount: 16,
      maxAttempts: 15,
      retryCount: 16,
      fetchedPageCount: 1600,
      fetchedTransferCount: 66404,
      providerCapHit: true,
      budgetExhausted: true,
      claimPreviousStatus: "running" as const
    };

    await runAddressIndexWorkerOnce({
      claimQueuedTronAddressUsdtIndexStates: async () => [staleRunningState],
      ensureAddressUsdtHistory,
      queueAddressUsdtHistory,
      failTronAddressUsdtIndexState: async () => undefined,
      markWaitingForensicJobsReadyAfterTargetedIndex,
      patchWaitingForensicJobsTargetedIndexProgress
    }, {
      claimLimit: 1,
      lockMs: 600_000,
      workerId: "worker-a",
      targetedRetry: {
        basePages: 200,
        maxPagesPerHop: 12000,
        escalationFactor: 2,
        maxAttempts: 8,
        retryDelayMs: 30_000
      }
    });

    expect(ensureAddressUsdtHistory).not.toHaveBeenCalled();
    expect(queueAddressUsdtHistory).toHaveBeenCalledWith(expect.objectContaining({
      address: "THop11111111111111111111111111111111",
      coverageMode: "targeted",
      targetTimestamp,
      requestedByJobId: "job-where-1",
      queuedReason: "where_is_money_hop",
      budgetPages: 4000,
      maxAttempts: 17
    }));
    expect(patchWaitingForensicJobsTargetedIndexProgress).toHaveBeenCalledWith(expect.objectContaining({
      indexStatus: "queued",
      statusReason: "partial_budget_exhausted",
      lastError: null,
      state: expect.objectContaining({
        budgetPages: 4000,
        maxAttempts: 17,
        providerCapHit: true,
        budgetExhausted: true
      })
    }));
    expect(markWaitingForensicJobsReadyAfterTargetedIndex).not.toHaveBeenCalled();
  });

  it("keeps requested targeted strict jobs waiting after retryable indexing failure", async () => {
    const targetTimestamp = new Date("2026-06-14T15:05:15.000Z");
    const markStrictProvenanceJobReadyAfterIndex = vi.fn(async () => false);
    const targetedState = {
      ...queuedIndexState("THop11111111111111111111111111111111"),
      coverageMode: "targeted" as const,
      targetTimestamp,
      requestedByJobId: "job-where-1",
      queuedReason: "where_is_money_hop",
      attemptCount: 1,
      maxAttempts: 5
    };

    await runAddressIndexWorkerOnce({
      claimQueuedTronAddressUsdtIndexStates: async () => [targetedState],
      ensureAddressUsdtHistory: async () => {
        throw new Error("temporary provider outage");
      },
      failTronAddressUsdtIndexState: async () => undefined,
      markStrictProvenanceJobReadyAfterIndex
    }, {
      claimLimit: 1,
      lockMs: 600_000,
      workerId: "worker-a"
    });

    expect(markStrictProvenanceJobReadyAfterIndex).toHaveBeenCalledWith({
      id: "job-where-1",
      address: "THop11111111111111111111111111111111",
      targetTimestamp,
      indexStatus: "failed_retryable",
      statusReason: "failed_retryable",
      lastError: "temporary provider outage"
    });
  });

  it("marks requested targeted strict jobs provider limited after terminal indexing failure", async () => {
    const targetTimestamp = new Date("2026-06-14T15:05:15.000Z");
    const markStrictProvenanceJobReadyAfterIndex = vi.fn(async () => true);
    const targetedState = {
      ...queuedIndexState("THop11111111111111111111111111111111"),
      coverageMode: "targeted" as const,
      targetTimestamp,
      requestedByJobId: "job-where-1",
      queuedReason: "where_is_money_hop",
      attemptCount: 5,
      maxAttempts: 5
    };

    await runAddressIndexWorkerOnce({
      claimQueuedTronAddressUsdtIndexStates: async () => [targetedState],
      ensureAddressUsdtHistory: async () => {
        throw new Error("provider exhausted");
      },
      failTronAddressUsdtIndexState: async () => undefined,
      markStrictProvenanceJobReadyAfterIndex
    }, {
      claimLimit: 1,
      lockMs: 600_000,
      workerId: "worker-a"
    });

    expect(markStrictProvenanceJobReadyAfterIndex).toHaveBeenCalledWith({
      id: "job-where-1",
      address: "THop11111111111111111111111111111111",
      targetTimestamp,
      indexStatus: "failed_terminal",
      statusReason: "failed_terminal",
      lastError: "provider exhausted"
    });
  });

  it("does not wake strict jobs for non-targeted or background indexing", async () => {
    const targetTimestamp = new Date("2026-06-14T15:05:15.000Z");
    const markStrictProvenanceJobReadyAfterIndex = vi.fn(async () => true);
    const allTimeState = {
      ...queuedIndexState("TDirect111111111111111111111111111111"),
      requestedByJobId: "job-where-1"
    };
    const backgroundTargetedState = {
      ...queuedIndexState("THop11111111111111111111111111111111"),
      coverageMode: "targeted" as const,
      targetTimestamp,
      requestedByJobId: null
    };

    await runAddressIndexWorkerOnce({
      claimQueuedTronAddressUsdtIndexStates: async () => [allTimeState, backgroundTargetedState],
      ensureAddressUsdtHistory: async (input) => ({
        ...allTimeState,
        address: input.address,
        coverageMode: input.coverageMode,
        targetTimestamp: input.targetTimestamp ?? null,
        status: "complete",
        statusReason: "complete_provider_windowed"
      }),
      failTronAddressUsdtIndexState: async () => undefined,
      markStrictProvenanceJobReadyAfterIndex
    }, {
      claimLimit: 2,
      lockMs: 600_000,
      workerId: "worker-a"
    });

    expect(markStrictProvenanceJobReadyAfterIndex).not.toHaveBeenCalled();
  });
});
