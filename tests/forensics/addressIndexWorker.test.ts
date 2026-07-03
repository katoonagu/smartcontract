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
      lastError: null
    });
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
