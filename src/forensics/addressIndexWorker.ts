import type {
  TronAddressUsdtCoverageMode,
  TronAddressUsdtCoverageStatusReason,
  TronAddressUsdtIndexRequestKind,
  TronAddressUsdtIndexState,
  TronAddressUsdtIndexStatus
} from "../types";

type AddressIndexErrorClass = "rate_limited" | "provider_error" | "provider_inconsistent" | "terminal";

type TargetedIndexRetryOptions = {
  basePages: number;
  maxPagesPerHop: number;
  maxWindowSplitDepth?: number;
  escalationFactor: number;
  maxAttempts: number;
  retryDelayMs: number;
};

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
      requestKind?: TronAddressUsdtIndexRequestKind | null;
      windowStartTimestamp?: Date | null;
      windowEndTimestamp?: Date | null;
      relatedHopTxHash?: string | null;
      candidateTxHash?: string | null;
      requestedByJobId?: string | null;
      queuedReason: string;
      maxPagesPerRun?: number | null;
      maxWindowSplitDepth?: number | null;
      lockOwner?: string | null;
      lockMs?: number | null;
    }): Promise<TronAddressUsdtIndexState>;
    queueAddressUsdtHistory?(input: {
      address: string;
      coverageMode: TronAddressUsdtCoverageMode;
      targetTimestamp?: Date | null;
      requestKind?: TronAddressUsdtIndexRequestKind | null;
      windowStartTimestamp?: Date | null;
      windowEndTimestamp?: Date | null;
      relatedHopTxHash?: string | null;
      candidateTxHash?: string | null;
      requestedByJobId?: string | null;
      queuedReason: string;
      priority?: number | null;
      nextRunAt?: Date | null;
      budgetPages?: number | null;
      maxAttempts?: number | null;
      allowRunningRequeue?: boolean | null;
    }): Promise<TronAddressUsdtIndexState>;
    failTronAddressUsdtIndexState(input: {
      address: string;
      coverageMode: TronAddressUsdtCoverageMode;
      targetTimestamp?: Date | null;
      requestKind?: TronAddressUsdtIndexRequestKind | null;
      windowStartTimestamp?: Date | null;
      windowEndTimestamp?: Date | null;
      relatedHopTxHash?: string | null;
      candidateTxHash?: string | null;
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
      requestKind?: TronAddressUsdtIndexRequestKind | null;
      windowStartTimestamp?: Date | null;
      windowEndTimestamp?: Date | null;
      relatedHopTxHash?: string | null;
      candidateTxHash?: string | null;
      indexStatus: TronAddressUsdtIndexStatus;
      statusReason: TronAddressUsdtCoverageStatusReason | null;
      lastError: string | null;
      state?: TronAddressUsdtIndexState | null;
    }): Promise<number | boolean>;
    reconcileWaitingForensicJobs?(): Promise<void>;
    onWaitReconciliationError?(): void;
    patchWaitingForensicJobsTargetedIndexProgress?(input: {
      address: string;
      targetTimestamp: Date | null;
      requestKind?: TronAddressUsdtIndexRequestKind | null;
      windowStartTimestamp?: Date | null;
      windowEndTimestamp?: Date | null;
      relatedHopTxHash?: string | null;
      candidateTxHash?: string | null;
      indexStatus: TronAddressUsdtIndexStatus;
      statusReason: TronAddressUsdtCoverageStatusReason | null;
      lastError: string | null;
      state?: TronAddressUsdtIndexState | null;
    }): Promise<number | boolean>;
  },
  options: {
    claimLimit: number;
    lockMs: number;
    workerId: string;
    targetedRetry?: Partial<TargetedIndexRetryOptions>;
  }
): Promise<{ claimed: number; completed: number; requeued: number; failed: number }> {
  const targetedRetry = normalizeTargetedRetryOptions(options.targetedRetry);
  const summary = { claimed: 0, completed: 0, requeued: 0, failed: 0 };
  const reconcileWaitingJobsAfterIndex = async (): Promise<void> => {
    try {
      await deps.reconcileWaitingForensicJobs?.();
    } catch {
      try {
        deps.onWaitReconciliationError?.();
      } catch {
        // A best-effort diagnostic cannot reclassify completed index work.
      }
    }
  };
  const states = await deps.claimQueuedTronAddressUsdtIndexStates({
    limit: options.claimLimit,
    lockOwner: options.workerId,
    lockMs: options.lockMs
  });
  summary.claimed = states.length;

  await Promise.all(states.map(async (state) => {
    try {
      if (shouldRequeueClaimedStaleTargetedIndex(state, targetedRetry)) {
        const statusReason = staleTargetedStatusReason(state);
        const queued = await deps.queueAddressUsdtHistory?.({
          address: state.address,
          coverageMode: "targeted",
          targetTimestamp: state.targetTimestamp,
          requestKind: state.requestKind,
          windowStartTimestamp: state.windowStartTimestamp,
          windowEndTimestamp: state.windowEndTimestamp,
          relatedHopTxHash: state.relatedHopTxHash,
          candidateTxHash: state.candidateTxHash,
          requestedByJobId: state.requestedByJobId,
          queuedReason: state.queuedReason ?? "where_is_money_hop",
          priority: state.priority,
          nextRunAt: new Date(Date.now() + targetedRetry.retryDelayMs),
          budgetPages: nextTargetedBudgetPages(state, targetedRetry),
          maxAttempts: nextTargetedMaxAttempts(state, targetedRetry),
          allowRunningRequeue: true
        });
        await deps.patchWaitingForensicJobsTargetedIndexProgress?.({
          address: state.address,
          targetTimestamp: state.targetTimestamp,
          requestKind: state.requestKind,
          windowStartTimestamp: state.windowStartTimestamp,
          windowEndTimestamp: state.windowEndTimestamp,
          relatedHopTxHash: state.relatedHopTxHash,
          candidateTxHash: state.candidateTxHash,
          indexStatus: "queued",
          statusReason,
          lastError: state.lastError,
          state: queued ?? {
            ...state,
            status: "queued",
            statusReason,
            budgetPages: nextTargetedBudgetPages(state, targetedRetry),
            maxAttempts: nextTargetedMaxAttempts(state, targetedRetry)
          }
        });
        summary.requeued += 1;
        return;
      }
      const completed = await deps.ensureAddressUsdtHistory({
        address: state.address,
        coverageMode: state.coverageMode,
        targetTimestamp: state.targetTimestamp,
        requestKind: state.requestKind,
        windowStartTimestamp: state.windowStartTimestamp,
        windowEndTimestamp: state.windowEndTimestamp,
        relatedHopTxHash: state.relatedHopTxHash,
        candidateTxHash: state.candidateTxHash,
        requestedByJobId: state.requestedByJobId,
        queuedReason: state.queuedReason ?? "background_index",
        maxPagesPerRun: state.budgetPages,
        maxWindowSplitDepth: state.coverageMode === "targeted" ? targetedRetry.maxWindowSplitDepth ?? null : null,
        lockOwner: options.workerId,
        lockMs: options.lockMs
      });
      if (shouldContinueTargetedIndex(completed, targetedRetry)) {
        const queued = await deps.queueAddressUsdtHistory?.({
          address: completed.address,
          coverageMode: "targeted",
          targetTimestamp: completed.targetTimestamp,
          requestKind: completed.requestKind,
          windowStartTimestamp: completed.windowStartTimestamp,
          windowEndTimestamp: completed.windowEndTimestamp,
          relatedHopTxHash: completed.relatedHopTxHash,
          candidateTxHash: completed.candidateTxHash,
          requestedByJobId: completed.requestedByJobId,
          queuedReason: completed.queuedReason ?? state.queuedReason ?? "where_is_money_hop",
          priority: completed.priority,
          nextRunAt: new Date(Date.now() + targetedRetry.retryDelayMs),
          budgetPages: nextTargetedBudgetPages(completed, targetedRetry),
          maxAttempts: nextTargetedMaxAttempts(completed, targetedRetry)
        });
        await deps.patchWaitingForensicJobsTargetedIndexProgress?.({
          address: completed.address,
          targetTimestamp: completed.targetTimestamp,
          requestKind: completed.requestKind,
          windowStartTimestamp: completed.windowStartTimestamp,
          windowEndTimestamp: completed.windowEndTimestamp,
          relatedHopTxHash: completed.relatedHopTxHash,
          candidateTxHash: completed.candidateTxHash,
          indexStatus: "queued",
          statusReason: completed.statusReason,
          lastError: completed.lastError,
          state: queued ?? completed
        });
        summary.requeued += 1;
        return;
      }
      if (state.coverageMode === "targeted") {
        if (deps.markWaitingForensicJobsReadyAfterTargetedIndex) {
          await deps.markWaitingForensicJobsReadyAfterTargetedIndex({
            address: completed.address,
            targetTimestamp: completed.targetTimestamp,
            requestKind: completed.requestKind,
            windowStartTimestamp: completed.windowStartTimestamp,
            windowEndTimestamp: completed.windowEndTimestamp,
            relatedHopTxHash: completed.relatedHopTxHash,
            candidateTxHash: completed.candidateTxHash,
            indexStatus: completed.status,
            statusReason: completed.statusReason,
            lastError: completed.lastError,
            state: completed
          });
          await reconcileWaitingJobsAfterIndex();
        }
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
      summary.completed += 1;
    } catch (error) {
      summary.failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      const errorClass = classifyAddressIndexError(error);
      await deps.failTronAddressUsdtIndexState({
        address: state.address,
        coverageMode: state.coverageMode,
        targetTimestamp: state.targetTimestamp,
        requestKind: state.requestKind,
        windowStartTimestamp: state.windowStartTimestamp,
        windowEndTimestamp: state.windowEndTimestamp,
        relatedHopTxHash: state.relatedHopTxHash,
        candidateTxHash: state.candidateTxHash,
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
      if (state.coverageMode === "targeted" && indexStatus === "failed_retryable") {
        await deps.patchWaitingForensicJobsTargetedIndexProgress?.({
          address: state.address,
          targetTimestamp: state.targetTimestamp,
          requestKind: state.requestKind,
          windowStartTimestamp: state.windowStartTimestamp,
          windowEndTimestamp: state.windowEndTimestamp,
          relatedHopTxHash: state.relatedHopTxHash,
          candidateTxHash: state.candidateTxHash,
          indexStatus,
          statusReason,
          lastError: message,
          state
        });
      }
      if (state.coverageMode === "targeted") {
        if (deps.markWaitingForensicJobsReadyAfterTargetedIndex) {
          await deps.markWaitingForensicJobsReadyAfterTargetedIndex({
            address: state.address,
            targetTimestamp: state.targetTimestamp,
            requestKind: state.requestKind,
            windowStartTimestamp: state.windowStartTimestamp,
            windowEndTimestamp: state.windowEndTimestamp,
            relatedHopTxHash: state.relatedHopTxHash,
            candidateTxHash: state.candidateTxHash,
            indexStatus,
            statusReason,
            lastError: message,
            state
          });
          if (indexStatus === "failed_terminal") await reconcileWaitingJobsAfterIndex();
        }
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
  return summary;
}

function shouldRequeueClaimedStaleTargetedIndex(
  state: TronAddressUsdtIndexState,
  options: TargetedIndexRetryOptions
): boolean {
  if (state.coverageMode !== "targeted") return false;
  if (state.claimPreviousStatus !== "running") return false;
  if (!targetedPartialNeedsBudgetEscalation(state) && state.statusReason !== "partial_provider_cap") return false;
  return nextTargetedBudgetPages(state, options) > (state.budgetPages ?? 0);
}

function staleTargetedStatusReason(state: TronAddressUsdtIndexState): TronAddressUsdtCoverageStatusReason {
  if (state.budgetExhausted === true) return "partial_budget_exhausted";
  if (state.statusReason) return state.statusReason;
  return state.providerCapHit === true ? "partial_provider_cap" : "partial_budget_exhausted";
}

function normalizeTargetedRetryOptions(input: Partial<TargetedIndexRetryOptions> | undefined): TargetedIndexRetryOptions {
  return {
    basePages: Math.max(1, Math.floor(input?.basePages ?? 200)),
    maxPagesPerHop: Math.max(1, Math.floor(input?.maxPagesPerHop ?? 2000)),
    maxWindowSplitDepth: input?.maxWindowSplitDepth === undefined
      ? undefined
      : Math.max(1, Math.floor(input.maxWindowSplitDepth)),
    escalationFactor: Math.max(1, Math.floor(input?.escalationFactor ?? 2)),
    maxAttempts: Math.max(1, Math.floor(input?.maxAttempts ?? 8)),
    retryDelayMs: Math.max(0, Math.floor(input?.retryDelayMs ?? 30_000))
  };
}

function shouldContinueTargetedIndex(state: TronAddressUsdtIndexState, options: TargetedIndexRetryOptions): boolean {
  if (state.coverageMode !== "targeted" || state.status !== "partial") return false;
  if (state.statusReason !== "partial_budget_exhausted" &&
    state.statusReason !== "partial_rate_limited" &&
    state.statusReason !== "partial_provider_cap") {
    return false;
  }
  const canEscalateBudget = targetedPartialNeedsBudgetEscalation(state) &&
    nextTargetedBudgetPages(state, options) > (state.budgetPages ?? 0);
  if (state.attemptCount >= Math.max(state.maxAttempts, options.maxAttempts) && !canEscalateBudget) return false;
  if (targetedPartialNeedsBudgetEscalation(state) && !canEscalateBudget) {
    return false;
  }
  return true;
}

function nextTargetedBudgetPages(state: TronAddressUsdtIndexState, options: TargetedIndexRetryOptions): number {
  const current = Math.max(options.basePages, state.budgetPages ?? 0);
  const fetched = Math.max(0, state.fetchedPageCount ?? 0);
  const escalated = targetedPartialNeedsBudgetEscalation(state)
    ? Math.max(current * options.escalationFactor, fetched * options.escalationFactor, current + options.basePages)
    : current;
  return Math.min(options.maxPagesPerHop, Math.max(options.basePages, Math.ceil(escalated)));
}

function targetedPartialNeedsBudgetEscalation(state: TronAddressUsdtIndexState): boolean {
  return state.statusReason === "partial_budget_exhausted" || state.budgetExhausted === true;
}

function nextTargetedMaxAttempts(state: TronAddressUsdtIndexState, options: TargetedIndexRetryOptions): number {
  const maxAttempts = Math.max(state.maxAttempts, options.maxAttempts);
  const canEscalateBudget = targetedPartialNeedsBudgetEscalation(state) &&
    nextTargetedBudgetPages(state, options) > (state.budgetPages ?? 0);
  return canEscalateBudget ? Math.max(maxAttempts, state.attemptCount + 1) : maxAttempts;
}
