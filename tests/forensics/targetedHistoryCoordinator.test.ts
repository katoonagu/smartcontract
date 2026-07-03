import { describe, expect, it, vi } from "vitest";
import {
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
});
