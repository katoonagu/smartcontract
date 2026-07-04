import { describe, expect, it, vi } from "vitest";
import {
  ensureCandidateWindowsOrWait,
  ensureTargetedHistoryOrWait,
  TargetedHistoryTerminalError,
  TargetedHistoryWaitingForIndex
} from "../../src/forensics/targetedHistoryCoordinator";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser";
import type { TronAddressUsdtIndexState } from "../../src/types";

function targetedState(overrides: Partial<TronAddressUsdtIndexState> = {}): TronAddressUsdtIndexState {
  const now = new Date("2026-07-03T00:00:00.000Z");
  return {
    address: "THop11111111111111111111111111111111",
    tokenContract: TRON_USDT_CONTRACT_ADDRESS,
    coverageMode: "targeted",
    coverageKind: "provider_windowed",
    targetTimestamp: new Date("2026-07-01T12:59:30.000Z"),
    status: "running",
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
    priority: 250,
    nextRunAt: now,
    attemptCount: 1,
    maxAttempts: 8,
    retryCount: 0,
    lastError: null,
    lastErrorClass: null,
    lastSuccessfulPageAt: null,
    queuedReason: "where_is_money_hop",
    requestedByJobId: "job-1",
    lockedAt: null,
    lockedUntil: null,
    heartbeatAt: null,
    lockOwner: null,
    budgetPages: 400,
    budgetSeconds: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function coordinatorCandidateWindowState(input: {
  address: string;
  targetTimestamp: Date;
  windowStartTimestamp: Date;
  windowEndTimestamp: Date;
  candidateTxHash: string;
  relatedHopTxHash: string;
  status?: TronAddressUsdtIndexState["status"];
  statusReason?: TronAddressUsdtIndexState["statusReason"];
}): TronAddressUsdtIndexState {
  return {
    address: input.address,
    tokenContract: TRON_USDT_CONTRACT_ADDRESS,
    coverageMode: "targeted",
    coverageKind: "provider_windowed",
    requestKind: "candidate_window",
    status: input.status ?? "queued",
    statusReason: input.statusReason ?? null,
    provider: null,
    totalReported: null,
    fetchedTransferCount: 0,
    uniqueCounterpartyCount: 0,
    newestTransferAt: null,
    oldestTransferAt: null,
    coveredUntilTimestamp: null,
    targetTimestamp: input.targetTimestamp,
    windowStartTimestamp: input.windowStartTimestamp,
    windowEndTimestamp: input.windowEndTimestamp,
    relatedHopTxHash: input.relatedHopTxHash,
    candidateTxHash: input.candidateTxHash,
    fetchedPageCount: 0,
    plannedPageCount: null,
    currentEndTimestamp: null,
    providerCapHit: false,
    budgetExhausted: false,
    providerInconsistent: false,
    priority: 240,
    nextRunAt: input.targetTimestamp,
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
    createdAt: input.targetTimestamp,
    updatedAt: input.targetTimestamp
  };
}

describe("ensureTargetedHistoryOrWait", () => {
  it("accepts a newer complete covering state even when the exact target is still queued", async () => {
    const requestedTarget = new Date("2026-07-01T12:39:03.000Z");
    const coveringTarget = new Date("2026-07-01T14:10:36.000Z");
    const exactQueued = targetedState({
      targetTimestamp: requestedTarget,
      status: "queued",
      statusReason: null,
      budgetPages: 400,
      providerCapHit: true,
      budgetExhausted: true
    });
    const coveringComplete = targetedState({
      targetTimestamp: coveringTarget,
      status: "complete",
      statusReason: "complete_provider_windowed",
      completedAt: new Date("2026-07-03T15:15:00.000Z")
    });
    const getCoveringAddressUsdtIndexState = vi.fn(async () => coveringComplete);
    const queueAddressUsdtHistory = vi.fn(async () => {
      throw new Error("covered target should not be queued");
    });
    const releaseForensicCheckJobToWaiting = vi.fn(async () => true);
    const upsertForensicJobWait = vi.fn(async () => undefined);

    await expect(ensureTargetedHistoryOrWait({
      jobId: "job-1",
      address: exactQueued.address,
      targetTimestamp: requestedTarget,
      queuedReason: "where_is_money_hop",
      requiredFor: "where_hop",
      progressJson: {},
      deps: {
        getAddressUsdtIndexState: vi.fn(async () => exactQueued),
        getCoveringAddressUsdtIndexState,
        queueAddressUsdtHistory,
        releaseForensicCheckJobToWaiting,
        upsertForensicJobWait
      },
      persistProgress: async (patch) => patch
    })).resolves.toBe(true);

    expect(getCoveringAddressUsdtIndexState).toHaveBeenCalledWith({
      address: exactQueued.address,
      coverageMode: "targeted",
      targetTimestamp: requestedTarget
    });
    expect(queueAddressUsdtHistory).not.toHaveBeenCalled();
    expect(releaseForensicCheckJobToWaiting).not.toHaveBeenCalled();
    expect(upsertForensicJobWait).not.toHaveBeenCalled();
  });

  it("uses a newer terminal covering state instead of waiting on an exact stale running state", async () => {
    const requestedTarget = new Date("2026-07-01T12:59:30.000Z");
    const coveringTarget = new Date("2026-07-01T14:10:36.000Z");
    const exactStale = targetedState({
      targetTimestamp: requestedTarget,
      status: "running",
      statusReason: null,
      lockOwner: "pid-old",
      lockedUntil: new Date("2026-07-03T14:24:40.000Z"),
      heartbeatAt: new Date("2026-07-03T14:14:40.000Z")
    });
    const coveringTerminal = targetedState({
      targetTimestamp: coveringTarget,
      status: "failed_terminal",
      statusReason: "partial_provider_cap",
      lastError: "provider cap unresolved after background budget"
    });
    const queueAddressUsdtHistory = vi.fn(async () => {
      throw new Error("terminal covering state should not be queued");
    });
    const releaseForensicCheckJobToWaiting = vi.fn(async () => true);

    await expect(ensureTargetedHistoryOrWait({
      jobId: "job-1",
      address: exactStale.address,
      targetTimestamp: requestedTarget,
      queuedReason: "where_is_money_hop",
      requiredFor: "where_hop",
      progressJson: {},
      deps: {
        getAddressUsdtIndexState: vi.fn(async () => exactStale),
        getCoveringAddressUsdtIndexState: vi.fn(async () => coveringTerminal),
        queueAddressUsdtHistory,
        releaseForensicCheckJobToWaiting,
        upsertForensicJobWait: vi.fn(async () => undefined)
      },
      persistProgress: async (patch) => patch
    })).rejects.toBeInstanceOf(TargetedHistoryTerminalError);

    expect(queueAddressUsdtHistory).not.toHaveBeenCalled();
    expect(releaseForensicCheckJobToWaiting).not.toHaveBeenCalled();
  });

  it("uses a newer terminal provider-cap partial covering state before an exact queued state", async () => {
    const requestedTarget = new Date("2026-07-01T12:59:30.000Z");
    const coveringTarget = new Date("2026-07-01T14:10:36.000Z");
    const exactQueued = targetedState({
      targetTimestamp: requestedTarget,
      status: "queued",
      statusReason: null
    });
    const coveringTerminal = targetedState({
      targetTimestamp: coveringTarget,
      status: "partial",
      statusReason: "partial_provider_cap",
      attemptCount: 12,
      maxAttempts: 12,
      budgetPages: 12000,
      providerCapHit: true,
      budgetExhausted: false,
      lastError: "provider cap unresolved after terminal budget"
    });
    const queueAddressUsdtHistory = vi.fn(async () => {
      throw new Error("terminal covering state should not be queued");
    });
    const releaseForensicCheckJobToWaiting = vi.fn(async () => true);

    await expect(ensureTargetedHistoryOrWait({
      jobId: "job-1",
      address: exactQueued.address,
      targetTimestamp: requestedTarget,
      queuedReason: "where_is_money_hop",
      requiredFor: "where_hop",
      progressJson: {},
      deps: {
        getAddressUsdtIndexState: vi.fn(async () => exactQueued),
        getCoveringAddressUsdtIndexState: vi.fn(async () => coveringTerminal),
        queueAddressUsdtHistory,
        releaseForensicCheckJobToWaiting,
        upsertForensicJobWait: vi.fn(async () => undefined)
      },
      persistProgress: async (patch) => patch
    })).rejects.toMatchObject({
      scoreBlockedReason: "provider_cap_unresolved",
      technicalStatus: "provider_cap_unresolved"
    });

    expect(queueAddressUsdtHistory).not.toHaveBeenCalled();
    expect(releaseForensicCheckJobToWaiting).not.toHaveBeenCalled();
  });

  it("waits on a newer same-address targeted state instead of queueing a duplicate older target", async () => {
    const requestedTarget = new Date("2026-07-01T11:43:24.000Z");
    const coveringTarget = new Date("2026-07-01T12:59:30.000Z");
    const coveringState = targetedState({ targetTimestamp: coveringTarget });
    const queueAddressUsdtHistory = vi.fn(async () => {
      throw new Error("duplicate queue should not be needed");
    });
    const upsertForensicJobWait = vi.fn(async () => undefined);
    const releaseForensicCheckJobToWaiting = vi.fn(async () => true);

    await expect(ensureTargetedHistoryOrWait({
      jobId: "job-1",
      address: coveringState.address,
      targetTimestamp: requestedTarget,
      queuedReason: "where_is_money_hop",
      requiredFor: "where_hop",
      progressJson: {},
      deps: {
        getAddressUsdtIndexState: vi.fn(async () => null),
        getCoveringAddressUsdtIndexState: vi.fn(async () => coveringState),
        queueAddressUsdtHistory,
        releaseForensicCheckJobToWaiting,
        upsertForensicJobWait
      },
      persistProgress: async (patch) => patch
    })).rejects.toBeInstanceOf(TargetedHistoryWaitingForIndex);

    expect(queueAddressUsdtHistory).not.toHaveBeenCalled();
    expect(upsertForensicJobWait).toHaveBeenCalledWith(expect.objectContaining({
      jobId: "job-1",
      address: coveringState.address,
      targetTimestamp: requestedTarget
    }));
    expect(releaseForensicCheckJobToWaiting).toHaveBeenCalledWith(expect.objectContaining({
      progressJson: expect.objectContaining({
        targetedIndex: expect.objectContaining({
          lastIndexStatus: "running",
          targetTimestamp: coveringTarget.toISOString()
        })
      })
    }));
  });

  it("requeues an old budget-exhausted provider-cap partial instead of treating it as terminal", async () => {
    const targetTimestamp = new Date("2026-07-01T12:39:03.000Z");
    const partialState = targetedState({
      targetTimestamp,
      status: "partial",
      statusReason: "partial_provider_cap",
      providerCapHit: true,
      budgetExhausted: true,
      budgetPages: 200,
      fetchedPageCount: 200,
      fetchedTransferCount: 3984,
      attemptCount: 8,
      maxAttempts: 8,
      retryCount: 8
    });
    const queuedState = targetedState({
      ...partialState,
      status: "queued",
      statusReason: null,
      budgetPages: 400,
      maxAttempts: 9
    });
    const queueAddressUsdtHistory = vi.fn(async () => queuedState);
    const upsertForensicJobWait = vi.fn(async () => undefined);
    const releaseForensicCheckJobToWaiting = vi.fn(async () => true);

    await expect(ensureTargetedHistoryOrWait({
      jobId: "job-1",
      address: partialState.address,
      targetTimestamp,
      queuedReason: "where_is_money_hop",
      requiredFor: "where_hop",
      progressJson: {},
      deps: {
        getAddressUsdtIndexState: vi.fn(async () => partialState),
        getCoveringAddressUsdtIndexState: vi.fn(async () => null),
        queueAddressUsdtHistory,
        releaseForensicCheckJobToWaiting,
        upsertForensicJobWait
      },
      persistProgress: async (patch) => patch
    })).rejects.toBeInstanceOf(TargetedHistoryWaitingForIndex);

    expect(queueAddressUsdtHistory).toHaveBeenCalledWith(expect.objectContaining({
      address: partialState.address,
      coverageMode: "targeted",
      targetTimestamp,
      requestedByJobId: "job-1",
      queuedReason: "where_is_money_hop",
      budgetPages: 400,
      maxAttempts: 9
    }));
    expect(upsertForensicJobWait).toHaveBeenCalledWith(expect.objectContaining({
      jobId: "job-1",
      address: partialState.address,
      targetTimestamp,
      requiredFor: "where_hop",
      statusReason: null
    }));
    expect(releaseForensicCheckJobToWaiting).toHaveBeenCalledWith(expect.objectContaining({
      id: "job-1",
      progressJson: expect.objectContaining({
        jobPhase: "waiting_for_targeted_index",
        targetedIndex: expect.objectContaining({
          lastIndexStatus: "queued",
          budgetPages: 400,
          maxAttempts: 9
        })
      })
    }));
  });

  it("does not treat a repaired invalid complete state as covered while it is queued", async () => {
    const targetTimestamp = new Date("2026-07-01T12:47:39.000Z");
    const repairedState = targetedState({
      targetTimestamp,
      status: "queued",
      statusReason: null,
      providerCapHit: true,
      budgetExhausted: true,
      budgetPages: 6400,
      fetchedPageCount: 1,
      attemptCount: 17,
      maxAttempts: 18
    });
    const queueAddressUsdtHistory = vi.fn(async () => {
      throw new Error("queued repair state should be reused");
    });
    const upsertForensicJobWait = vi.fn(async () => undefined);
    const releaseForensicCheckJobToWaiting = vi.fn(async () => true);

    await expect(ensureTargetedHistoryOrWait({
      jobId: "job-1",
      address: repairedState.address,
      targetTimestamp,
      queuedReason: "where_is_money_hop",
      requiredFor: "where_hop",
      progressJson: {},
      deps: {
        getAddressUsdtIndexState: vi.fn(async () => repairedState),
        getCoveringAddressUsdtIndexState: vi.fn(async () => null),
        queueAddressUsdtHistory,
        releaseForensicCheckJobToWaiting,
        upsertForensicJobWait
      },
      persistProgress: async (patch) => patch
    })).rejects.toBeInstanceOf(TargetedHistoryWaitingForIndex);

    expect(queueAddressUsdtHistory).not.toHaveBeenCalled();
    expect(upsertForensicJobWait).toHaveBeenCalledWith(expect.objectContaining({
      jobId: "job-1",
      address: repairedState.address,
      targetTimestamp,
      requiredFor: "where_hop",
      statusReason: null
    }));
    expect(releaseForensicCheckJobToWaiting).toHaveBeenCalledWith(expect.objectContaining({
      id: "job-1",
      progressJson: expect.objectContaining({
        jobPhase: "waiting_for_targeted_index",
        targetedIndex: expect.objectContaining({
          lastIndexStatus: "queued",
          providerCapHit: true,
          budgetExhausted: true,
          budgetPages: 6400
        })
      })
    }));
  });

  it("does not requeue budget-exhausted targeted state after the configured retry budget ceiling", async () => {
    const targetTimestamp = new Date("2026-07-01T12:59:30.000Z");
    const terminalBudgetState = targetedState({
      targetTimestamp,
      status: "partial",
      statusReason: "partial_budget_exhausted",
      providerCapHit: true,
      budgetExhausted: true,
      budgetPages: 12000,
      fetchedPageCount: 12000,
      fetchedTransferCount: 42000,
      attemptCount: 18,
      maxAttempts: 18,
      retryCount: 18
    });
    const queueAddressUsdtHistory = vi.fn(async () => {
      throw new Error("ceiling budget partial must not be requeued");
    });
    const releaseForensicCheckJobToWaiting = vi.fn(async () => true);

    await expect(ensureTargetedHistoryOrWait({
      jobId: "job-1",
      address: terminalBudgetState.address,
      targetTimestamp,
      queuedReason: "where_is_money_hop",
      requiredFor: "where_hop",
      maxRetryBudgetPages: 12000,
      progressJson: {},
      deps: {
        getAddressUsdtIndexState: vi.fn(async () => terminalBudgetState),
        getCoveringAddressUsdtIndexState: vi.fn(async () => null),
        queueAddressUsdtHistory,
        releaseForensicCheckJobToWaiting,
        upsertForensicJobWait: vi.fn(async () => undefined)
      },
      persistProgress: async (patch) => patch
    })).rejects.toMatchObject({
      scoreBlockedReason: "partial_budget_exhausted",
      technicalStatus: "budget_limited"
    });

    expect(queueAddressUsdtHistory).not.toHaveBeenCalled();
    expect(releaseForensicCheckJobToWaiting).not.toHaveBeenCalled();
  });

  it("caps retry budget at the configured ceiling when requeueing provider-cap partials", async () => {
    const targetTimestamp = new Date("2026-07-01T12:59:30.000Z");
    const partialState = targetedState({
      targetTimestamp,
      status: "partial",
      statusReason: "partial_provider_cap",
      providerCapHit: true,
      budgetExhausted: true,
      budgetPages: 6400,
      fetchedPageCount: 6400,
      fetchedTransferCount: 38000,
      attemptCount: 17,
      maxAttempts: 17,
      retryCount: 17
    });
    const queuedState = targetedState({
      ...partialState,
      status: "queued",
      statusReason: null,
      budgetPages: 12000,
      maxAttempts: 18
    });
    const queueAddressUsdtHistory = vi.fn(async () => queuedState);
    const releaseForensicCheckJobToWaiting = vi.fn(async () => true);

    await expect(ensureTargetedHistoryOrWait({
      jobId: "job-1",
      address: partialState.address,
      targetTimestamp,
      queuedReason: "where_is_money_hop",
      requiredFor: "where_hop",
      maxRetryBudgetPages: 12000,
      progressJson: {},
      deps: {
        getAddressUsdtIndexState: vi.fn(async () => partialState),
        getCoveringAddressUsdtIndexState: vi.fn(async () => null),
        queueAddressUsdtHistory,
        releaseForensicCheckJobToWaiting,
        upsertForensicJobWait: vi.fn(async () => undefined)
      },
      persistProgress: async (patch) => patch
    })).rejects.toBeInstanceOf(TargetedHistoryWaitingForIndex);

    expect(queueAddressUsdtHistory).toHaveBeenCalledWith(expect.objectContaining({
      budgetPages: 12000,
      maxAttempts: 18
    }));
  });

  it("does not extend rate-limited targeted partials after max attempts", async () => {
    const targetTimestamp = new Date("2026-07-01T12:59:30.000Z");
    const rateLimitedState = targetedState({
      targetTimestamp,
      status: "partial",
      statusReason: "partial_rate_limited",
      lastError: "429 too many requests",
      attemptCount: 8,
      maxAttempts: 8,
      retryCount: 8,
      budgetPages: 12000,
      fetchedPageCount: 500
    });
    const queueAddressUsdtHistory = vi.fn(async () => {
      throw new Error("rate-limited terminal state must not be requeued");
    });

    await expect(ensureTargetedHistoryOrWait({
      jobId: "job-1",
      address: rateLimitedState.address,
      targetTimestamp,
      queuedReason: "where_is_money_hop",
      requiredFor: "where_hop",
      maxRetryBudgetPages: 12000,
      progressJson: {},
      deps: {
        getAddressUsdtIndexState: vi.fn(async () => rateLimitedState),
        getCoveringAddressUsdtIndexState: vi.fn(async () => null),
        queueAddressUsdtHistory,
        releaseForensicCheckJobToWaiting: vi.fn(async () => true),
        upsertForensicJobWait: vi.fn(async () => undefined)
      },
      persistProgress: async (patch) => patch
    })).rejects.toMatchObject({
      scoreBlockedReason: "rate_limited_after_retries",
      technicalStatus: "provider_limited"
    });

    expect(queueAddressUsdtHistory).not.toHaveBeenCalled();
  });

  it("retries rate-limited targeted partials without increasing the page budget", async () => {
    const targetTimestamp = new Date("2026-07-01T12:59:30.000Z");
    const rateLimitedState = targetedState({
      targetTimestamp,
      status: "partial",
      statusReason: "partial_rate_limited",
      lastError: "429 too many requests",
      attemptCount: 3,
      maxAttempts: 8,
      retryCount: 3,
      budgetPages: 12000,
      fetchedPageCount: 500
    });
    const queuedState = targetedState({
      ...rateLimitedState,
      status: "queued",
      statusReason: null,
      budgetPages: 12000,
      maxAttempts: 8
    });
    const queueAddressUsdtHistory = vi.fn(async () => queuedState);

    await expect(ensureTargetedHistoryOrWait({
      jobId: "job-1",
      address: rateLimitedState.address,
      targetTimestamp,
      queuedReason: "where_is_money_hop",
      requiredFor: "where_hop",
      maxRetryBudgetPages: 12000,
      progressJson: {},
      deps: {
        getAddressUsdtIndexState: vi.fn(async () => rateLimitedState),
        getCoveringAddressUsdtIndexState: vi.fn(async () => null),
        queueAddressUsdtHistory,
        releaseForensicCheckJobToWaiting: vi.fn(async () => true),
        upsertForensicJobWait: vi.fn(async () => undefined)
      },
      persistProgress: async (patch) => patch
    })).rejects.toBeInstanceOf(TargetedHistoryWaitingForIndex);

    expect(queueAddressUsdtHistory).toHaveBeenCalledWith(expect.objectContaining({
      budgetPages: 12000,
      maxAttempts: 8
    }));
  });
});

describe("ensureCandidateWindowsOrWait", () => {
  it("queues candidate-window waits without broad covering lookup", async () => {
    const queued: unknown[] = [];
    const waits: unknown[] = [];
    const releaseForensicCheckJobToWaiting = vi.fn(async () => true);

    await expect(ensureCandidateWindowsOrWait({
      jobId: "where-job-1",
      requests: [{
        address: "THop111111111111111111111111111111",
        targetTimestamp: new Date("2026-07-04T12:00:00.000Z"),
        windowStartTimestamp: new Date("2026-07-04T11:59:00.000Z"),
        windowEndTimestamp: new Date("2026-07-04T12:00:00.000Z"),
        relatedHopTxHash: "hop-tx-1",
        candidateTxHash: "candidate-tx-1",
        requestedAmountRaw: "100000000",
        candidateAmountRaw: "70000000",
        coverageShare: 0.7
      }],
      progressJson: {},
      persistProgress: async (patch) => patch,
      deps: {
        getAddressUsdtIndexState: async () => null,
        getCoveringAddressUsdtIndexState: async () => {
          throw new Error("candidate windows must not use broad covering lookup");
        },
        queueAddressUsdtHistory: async (input) => {
          queued.push(input);
          return coordinatorCandidateWindowState({
            address: input.address,
            targetTimestamp: input.targetTimestamp!,
            windowStartTimestamp: input.windowStartTimestamp!,
            windowEndTimestamp: input.windowEndTimestamp!,
            candidateTxHash: input.candidateTxHash!,
            relatedHopTxHash: input.relatedHopTxHash!,
            status: "queued"
          });
        },
        releaseForensicCheckJobToWaiting,
        upsertForensicJobWait: async (input) => {
          waits.push(input);
        }
      }
    })).rejects.toThrow("targeted_history_waiting_for_index");

    expect(queued[0]).toMatchObject({
      requestKind: "candidate_window",
      queuedReason: "where_candidate_window",
      candidateTxHash: "candidate-tx-1"
    });
    expect(waits[0]).toMatchObject({
      requestKind: "candidate_window",
      candidateTxHash: "candidate-tx-1"
    });
    expect(releaseForensicCheckJobToWaiting).toHaveBeenCalledWith(expect.objectContaining({
      progressJson: expect.objectContaining({
        jobPhase: "waiting_for_targeted_index",
        targetedIndex: expect.objectContaining({
          phase: "checking_candidate_windows",
          scoreValid: false,
          broadFallback: "not_queued",
          candidateWindows: expect.objectContaining({
            total: 1,
            queued: 1,
            pending: 1
          })
        })
      })
    }));
  });

  it("rechecks exact candidate-window states after release, marks ready, and still waits", async () => {
    const request = {
      address: "THop222222222222222222222222222222",
      targetTimestamp: new Date("2026-07-04T12:00:00.000Z"),
      windowStartTimestamp: new Date("2026-07-04T11:59:00.000Z"),
      windowEndTimestamp: new Date("2026-07-04T12:00:00.000Z"),
      relatedHopTxHash: "hop-tx-2",
      candidateTxHash: "candidate-tx-2",
      requestedAmountRaw: "100000000",
      candidateAmountRaw: "70000000",
      coverageShare: 0.7
    };
    const queuedState = coordinatorCandidateWindowState({
      address: request.address,
      targetTimestamp: request.targetTimestamp,
      windowStartTimestamp: request.windowStartTimestamp,
      windowEndTimestamp: request.windowEndTimestamp,
      candidateTxHash: request.candidateTxHash,
      relatedHopTxHash: request.relatedHopTxHash,
      status: "queued"
    });
    const completeState = coordinatorCandidateWindowState({
      address: request.address,
      targetTimestamp: request.targetTimestamp,
      windowStartTimestamp: request.windowStartTimestamp,
      windowEndTimestamp: request.windowEndTimestamp,
      candidateTxHash: request.candidateTxHash,
      relatedHopTxHash: request.relatedHopTxHash,
      status: "complete",
      statusReason: "complete_provider_windowed"
    });
    const getAddressUsdtIndexState = vi.fn(async () => getAddressUsdtIndexState.mock.calls.length === 1
      ? null
      : completeState);
    const getCoveringAddressUsdtIndexState = vi.fn(async () => {
      throw new Error("candidate windows must not use broad covering lookup");
    });
    const releaseForensicCheckJobToWaiting = vi.fn(async () => true);
    const markWaitingForensicJobsReadyAfterTargetedIndex = vi.fn(async () => 1);

    await expect(ensureCandidateWindowsOrWait({
      jobId: "where-job-1",
      requests: [request],
      progressJson: {},
      persistProgress: async (patch) => patch,
      deps: {
        getAddressUsdtIndexState,
        getCoveringAddressUsdtIndexState,
        queueAddressUsdtHistory: async () => queuedState,
        releaseForensicCheckJobToWaiting,
        upsertForensicJobWait: async () => undefined,
        markWaitingForensicJobsReadyAfterTargetedIndex
      }
    })).rejects.toBeInstanceOf(TargetedHistoryWaitingForIndex);

    expect(getAddressUsdtIndexState).toHaveBeenCalledTimes(2);
    expect(getAddressUsdtIndexState).toHaveBeenLastCalledWith({
      address: request.address,
      coverageMode: "targeted",
      requestKind: "candidate_window",
      targetTimestamp: request.targetTimestamp,
      windowStartTimestamp: request.windowStartTimestamp,
      windowEndTimestamp: request.windowEndTimestamp,
      candidateTxHash: request.candidateTxHash
    });
    expect(getCoveringAddressUsdtIndexState).not.toHaveBeenCalled();
    expect(releaseForensicCheckJobToWaiting).toHaveBeenCalledOnce();
    expect(markWaitingForensicJobsReadyAfterTargetedIndex).toHaveBeenCalledWith(expect.objectContaining({
      address: request.address,
      requestKind: "candidate_window",
      targetTimestamp: request.targetTimestamp,
      windowStartTimestamp: request.windowStartTimestamp,
      windowEndTimestamp: request.windowEndTimestamp,
      relatedHopTxHash: request.relatedHopTxHash,
      candidateTxHash: request.candidateTxHash,
      indexStatus: "complete",
      statusReason: "complete_provider_windowed"
    }));
  });

  it("does not wait forever when candidate windows are already terminal", async () => {
    const request = {
      address: "THop333333333333333333333333333333",
      targetTimestamp: new Date("2026-07-04T12:00:00.000Z"),
      windowStartTimestamp: new Date("2026-07-04T11:59:00.000Z"),
      windowEndTimestamp: new Date("2026-07-04T12:00:00.000Z"),
      relatedHopTxHash: "hop-tx-3",
      candidateTxHash: "candidate-tx-3",
      requestedAmountRaw: "100000000",
      candidateAmountRaw: "70000000",
      coverageShare: 0.7
    };
    const terminalState = coordinatorCandidateWindowState({
      address: request.address,
      targetTimestamp: request.targetTimestamp,
      windowStartTimestamp: request.windowStartTimestamp,
      windowEndTimestamp: request.windowEndTimestamp,
      candidateTxHash: request.candidateTxHash,
      relatedHopTxHash: request.relatedHopTxHash,
      status: "partial",
      statusReason: "partial_provider_inconsistent"
    });
    const releaseForensicCheckJobToWaiting = vi.fn(async () => true);
    const upsertForensicJobWait = vi.fn(async () => undefined);
    const markWaitingForensicJobsReadyAfterTargetedIndex = vi.fn(async () => 1);

    await expect(ensureCandidateWindowsOrWait({
      jobId: "where-job-1",
      requests: [request],
      progressJson: {},
      persistProgress: async (patch) => patch,
      deps: {
        getAddressUsdtIndexState: vi.fn(async () => terminalState),
        queueAddressUsdtHistory: async () => {
          throw new Error("terminal candidate window should not be requeued");
        },
        releaseForensicCheckJobToWaiting,
        upsertForensicJobWait,
        markWaitingForensicJobsReadyAfterTargetedIndex
      }
    })).resolves.toBe(true);

    expect(upsertForensicJobWait).not.toHaveBeenCalled();
    expect(releaseForensicCheckJobToWaiting).not.toHaveBeenCalled();
    expect(markWaitingForensicJobsReadyAfterTargetedIndex).not.toHaveBeenCalled();
  });
});
