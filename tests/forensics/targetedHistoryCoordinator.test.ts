import { describe, expect, it, vi } from "vitest";
import {
  ensureTargetedHistoryOrWait,
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
});
