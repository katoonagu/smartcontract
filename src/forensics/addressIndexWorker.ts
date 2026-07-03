import type {
  TronAddressUsdtCoverageMode,
  TronAddressUsdtCoverageStatusReason,
  TronAddressUsdtIndexState,
  TronAddressUsdtIndexStatus
} from "../types";

type AddressIndexErrorClass = "rate_limited" | "provider_error" | "provider_inconsistent" | "terminal";

export function classifyAddressIndexError(error: unknown): AddressIndexErrorClass {
  const message = error instanceof Error ? error.message : String(error);
  if (/\b(429|rate limit|too many requests|403)\b/i.test(message)) return "rate_limited";
  if (/inconsistent/i.test(message)) return "provider_inconsistent";
  return "provider_error";
}

export async function runAddressIndexWorkerOnce(
  deps: {
    claimQueuedTronAddressUsdtIndexStates(input: {
      limit: number;
      lockOwner: string;
      lockMs: number;
    }): Promise<TronAddressUsdtIndexState[]>;
    ensureAddressUsdtHistory(input: {
      address: string;
      coverageMode: TronAddressUsdtCoverageMode;
      targetTimestamp?: Date | null;
      requestedByJobId?: string | null;
      queuedReason: string;
      maxPagesPerRun?: number | null;
    }): Promise<TronAddressUsdtIndexState>;
    failTronAddressUsdtIndexState(input: {
      address: string;
      coverageMode: TronAddressUsdtCoverageMode;
      targetTimestamp?: Date | null;
      error: string;
      errorClass: AddressIndexErrorClass;
    }): Promise<void>;
    markStrictProvenanceJobReadyAfterIndex?(input: {
      id: string;
      address: string;
      targetTimestamp: Date | null;
      indexStatus: TronAddressUsdtIndexStatus;
      statusReason: TronAddressUsdtCoverageStatusReason | null;
      lastError: string | null;
    }): Promise<boolean>;
    markWaitingForensicJobsReadyAfterTargetedIndex?(input: {
      address: string;
      targetTimestamp: Date | null;
      indexStatus: TronAddressUsdtIndexStatus;
      statusReason: TronAddressUsdtCoverageStatusReason | null;
      lastError: string | null;
    }): Promise<number | boolean>;
  },
  options: { claimLimit: number; lockMs: number; workerId: string }
): Promise<void> {
  const states = await deps.claimQueuedTronAddressUsdtIndexStates({
    limit: options.claimLimit,
    lockOwner: options.workerId,
    lockMs: options.lockMs
  });

  await Promise.all(states.map(async (state) => {
    try {
      const completed = await deps.ensureAddressUsdtHistory({
        address: state.address,
        coverageMode: state.coverageMode,
        targetTimestamp: state.targetTimestamp,
        requestedByJobId: state.requestedByJobId,
        queuedReason: state.queuedReason ?? "background_index",
        maxPagesPerRun: state.budgetPages
      });
      if (state.coverageMode === "targeted") {
        await deps.markWaitingForensicJobsReadyAfterTargetedIndex?.({
          address: completed.address,
          targetTimestamp: completed.targetTimestamp,
          indexStatus: completed.status,
          statusReason: completed.statusReason,
          lastError: completed.lastError
        });
      }
      if (state.requestedByJobId && state.coverageMode === "targeted") {
        await deps.markStrictProvenanceJobReadyAfterIndex?.({
          id: state.requestedByJobId,
          address: completed.address,
          targetTimestamp: completed.targetTimestamp,
          indexStatus: completed.status,
          statusReason: completed.statusReason,
          lastError: completed.lastError
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const errorClass = classifyAddressIndexError(error);
      await deps.failTronAddressUsdtIndexState({
        address: state.address,
        coverageMode: state.coverageMode,
        targetTimestamp: state.targetTimestamp,
        error: message,
        errorClass
      });
      const indexStatus: TronAddressUsdtIndexStatus =
        errorClass !== "terminal" && state.attemptCount < state.maxAttempts ? "failed_retryable" : "failed_terminal";
      const statusReason: TronAddressUsdtCoverageStatusReason =
        errorClass === "rate_limited"
          ? "partial_rate_limited"
          : errorClass === "provider_inconsistent"
            ? "partial_provider_inconsistent"
            : indexStatus === "failed_retryable"
              ? "failed_retryable"
              : "failed_terminal";
      if (state.coverageMode === "targeted") {
        await deps.markWaitingForensicJobsReadyAfterTargetedIndex?.({
          address: state.address,
          targetTimestamp: state.targetTimestamp,
          indexStatus,
          statusReason,
          lastError: message
        });
      }
      if (state.requestedByJobId && state.coverageMode === "targeted") {
        await deps.markStrictProvenanceJobReadyAfterIndex?.({
          id: state.requestedByJobId,
          address: state.address,
          targetTimestamp: state.targetTimestamp,
          indexStatus,
          statusReason,
          lastError: message
        });
      }
    }
  }));
}
