import type { ForensicJobProgressPatch } from "./forensicJobProgress";
import type {
  ForensicScoreBlockedReason,
  ForensicTechnicalStatus,
  TronAddressUsdtCoverageMode,
  TronAddressUsdtCoverageStatusReason,
  TronAddressUsdtIndexRequestKind,
  TronAddressUsdtIndexState,
  WhereCandidateWindowRequest
} from "../types";

export type TargetedHistoryRequiredFor = "where_hop" | "incoming_hop";

const TARGETED_HISTORY_MIN_MAX_ATTEMPTS = 8;
const TARGETED_HISTORY_RETRY_MIN_BUDGET_PAGES = 200;
const TARGETED_HISTORY_RETRY_ESCALATION_FACTOR = 2;

export class TargetedHistoryWaitingForIndex extends Error {
  constructor() {
    super("targeted_history_waiting_for_index");
  }
}

export class TargetedHistoryTerminalError extends Error {
  readonly scoreBlockedReason: ForensicScoreBlockedReason;
  readonly technicalStatus: ForensicTechnicalStatus;

  constructor(input: {
    message: string;
    scoreBlockedReason: ForensicScoreBlockedReason;
    technicalStatus: ForensicTechnicalStatus;
  }) {
    super(input.message);
    this.scoreBlockedReason = input.scoreBlockedReason;
    this.technicalStatus = input.technicalStatus;
  }
}

export type TargetedHistoryWaiterDeps = {
  getAddressUsdtIndexState(input: {
    address: string;
    coverageMode: TronAddressUsdtCoverageMode;
    targetTimestamp?: Date | null;
    requestKind?: TronAddressUsdtIndexRequestKind | null;
    windowStartTimestamp?: Date | null;
    windowEndTimestamp?: Date | null;
    candidateTxHash?: string | null;
  }): Promise<TronAddressUsdtIndexState | null>;
  getCoveringAddressUsdtIndexState?(input: {
    address: string;
    coverageMode: TronAddressUsdtCoverageMode;
    targetTimestamp: Date;
  }): Promise<TronAddressUsdtIndexState | null>;
  queueAddressUsdtHistory(input: {
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
    budgetPages?: number | null;
    maxAttempts?: number | null;
  }): Promise<TronAddressUsdtIndexState>;
  releaseForensicCheckJobToWaiting(input: {
    id: string;
    progressJson: Record<string, unknown>;
    lastError?: string | null;
  }): Promise<boolean>;
  upsertForensicJobWait?(input: {
    jobId: string;
    address: string;
    targetTimestamp: Date;
    requestKind?: TronAddressUsdtIndexRequestKind | null;
    windowStartTimestamp?: Date | null;
    windowEndTimestamp?: Date | null;
    relatedHopTxHash?: string | null;
    candidateTxHash?: string | null;
    requiredFor: TargetedHistoryRequiredFor;
    statusReason?: TronAddressUsdtCoverageStatusReason | null;
    lastError?: string | null;
  }): Promise<void>;
  markWaitingForensicJobsReadyAfterTargetedIndex?(input: {
    address: string;
    targetTimestamp: Date | null;
    requestKind?: TronAddressUsdtIndexRequestKind | null;
    windowStartTimestamp?: Date | null;
    windowEndTimestamp?: Date | null;
    relatedHopTxHash?: string | null;
    candidateTxHash?: string | null;
    indexStatus: TronAddressUsdtIndexState["status"];
    statusReason: TronAddressUsdtCoverageStatusReason | null;
    lastError: string | null;
    state?: TronAddressUsdtIndexState | null;
  }): Promise<number | boolean>;
};

export type TargetedHistoryWaitInput = {
  jobId: string;
  address: string;
  targetTimestamp: Date;
  queuedReason: string;
  requiredFor: TargetedHistoryRequiredFor;
  maxRetryBudgetPages?: number | null;
  progressJson: Record<string, unknown>;
  deps: TargetedHistoryWaiterDeps;
  persistProgress(patch: ForensicJobProgressPatch): Promise<Record<string, unknown> | void>;
  afterWaitingPatch?: ForensicJobProgressPatch;
};

export type CandidateWindowWaitInput = {
  jobId: string;
  requests: WhereCandidateWindowRequest[];
  progressJson: Record<string, unknown>;
  deps: TargetedHistoryWaiterDeps;
  persistProgress(patch: ForensicJobProgressPatch): Promise<Record<string, unknown> | void>;
};

export function targetedHistoryWaitingProgressPatch(input: {
  address: string;
  targetTimestamp: Date;
  queuedReason: string;
  requiredFor: TargetedHistoryRequiredFor;
  state?: TronAddressUsdtIndexState | null;
}): ForensicJobProgressPatch {
  return {
    jobPhase: "waiting_for_targeted_index",
    targetedIndex: {
      phase: "waiting_for_targeted_index",
      scoreValid: false,
      waitingFor: {
        address: input.address,
        coverageMode: "targeted",
        targetTimestamp: input.targetTimestamp.toISOString(),
        queuedReason: input.queuedReason,
        requiredFor: input.requiredFor
      },
      lastIndexStatus: input.state?.status ?? null,
      statusReason: input.state?.statusReason ?? null,
      targetTimestamp: input.state?.targetTimestamp?.toISOString() ?? input.targetTimestamp.toISOString(),
      ...targetedIndexStateProgress(input.state)
    }
  };
}

export function targetedHistoryReadyProgressPatch(input: {
  address: string;
  targetTimestamp: Date | null;
  indexStatus: TronAddressUsdtIndexState["status"];
  statusReason: TronAddressUsdtCoverageStatusReason | null;
  lastError: string | null;
  state?: TronAddressUsdtIndexState | null;
}): ForensicJobProgressPatch {
  const terminal = input.indexStatus !== "complete";
  const mapped = terminal ? targetedHistoryTerminalStatus(input.statusReason, input.lastError) : null;
  return {
    jobPhase: terminal ? "provider_limited" : "reading_local_index",
    targetedIndex: {
      phase: terminal ? "provider_limited" : "reading_local_index",
      scoreValid: terminal ? false : null,
      scoreBlockedReason: mapped?.scoreBlockedReason ?? null,
      technicalStatus: mapped?.technicalStatus ?? "completed",
      waitingFor: null,
      lastIndexedAddress: input.address,
      lastIndexedTargetTimestamp: input.targetTimestamp?.toISOString() ?? null,
      lastIndexStatus: input.indexStatus,
      statusReason: input.statusReason,
      lastError: input.lastError,
      ...targetedIndexStateProgress(input.state, input.lastError)
    }
  };
}

export async function ensureTargetedHistoryOrWait(input: TargetedHistoryWaitInput): Promise<true> {
  const existing = await input.deps.getAddressUsdtIndexState({
    address: input.address,
    coverageMode: "targeted",
    targetTimestamp: input.targetTimestamp
  });
  if (isTargetedHistoryCovered(existing)) return true;
  const covering = (await input.deps.getCoveringAddressUsdtIndexState?.({
    address: input.address,
    coverageMode: "targeted",
    targetTimestamp: input.targetTimestamp
  }) ?? null);
  if (isTargetedHistoryCovered(covering)) return true;
  throwIfTerminal(covering, input.maxRetryBudgetPages);
  throwIfTerminal(existing, input.maxRetryBudgetPages);

  const retryablePartial = existing && isRetryablePartialState(existing, input.maxRetryBudgetPages)
    ? existing
    : covering && isRetryablePartialState(covering, input.maxRetryBudgetPages)
      ? covering
      : null;
  const queueTargetTimestamp = covering?.targetTimestamp ?? input.targetTimestamp;
  const queued = isTargetedHistoryAlreadyInFlight(existing)
    ? existing!
    : isTargetedHistoryAlreadyInFlight(covering)
      ? covering!
      : await input.deps.queueAddressUsdtHistory({
          address: input.address,
          coverageMode: "targeted",
          targetTimestamp: queueTargetTimestamp,
          requestedByJobId: input.jobId,
          queuedReason: input.queuedReason,
          budgetPages: retryablePartial ? nextRetryablePartialBudgetPages(retryablePartial, input.maxRetryBudgetPages) : undefined,
          maxAttempts: retryablePartial ? nextRetryablePartialMaxAttempts(retryablePartial) : undefined
        });
  if (isTargetedHistoryCovered(queued)) return true;
  throwIfTerminal(queued, input.maxRetryBudgetPages);

  await input.deps.upsertForensicJobWait?.({
    jobId: input.jobId,
    address: input.address,
    targetTimestamp: input.targetTimestamp,
    requiredFor: input.requiredFor,
    statusReason: queued.statusReason,
    lastError: queued.lastError
  });

  const patch = {
    ...targetedHistoryWaitingProgressPatch({
      address: input.address,
      targetTimestamp: queueTargetTimestamp,
      queuedReason: input.queuedReason,
      requiredFor: input.requiredFor,
      state: queued
    }),
    ...(input.afterWaitingPatch ?? {})
  };
  const persisted = await input.persistProgress(patch);
  const progressJson = persisted ?? input.progressJson;
  const released = await input.deps.releaseForensicCheckJobToWaiting({
    id: input.jobId,
    progressJson,
    lastError: null
  });
  if (!released) throw new Error("targeted_history_wait_release_failed");

  const afterRelease = (await input.deps.getAddressUsdtIndexState({
    address: input.address,
    coverageMode: "targeted",
    targetTimestamp: queueTargetTimestamp
  })) ?? (await input.deps.getCoveringAddressUsdtIndexState?.({
      address: input.address,
      coverageMode: "targeted",
      targetTimestamp: input.targetTimestamp
    }) ?? null);
  if (afterRelease && isTargetedHistoryFinished(afterRelease)) {
    await input.deps.markWaitingForensicJobsReadyAfterTargetedIndex?.({
      address: afterRelease.address,
      targetTimestamp: afterRelease.targetTimestamp,
      indexStatus: afterRelease.status,
      statusReason: afterRelease.statusReason,
      lastError: afterRelease.lastError,
      state: afterRelease
    });
  }

  throw new TargetedHistoryWaitingForIndex();
}

export function candidateWindowWaitingProgressPatch(input: {
  requests: readonly WhereCandidateWindowRequest[];
  states: readonly TronAddressUsdtIndexState[];
}): ForensicJobProgressPatch {
  const complete = input.states.filter((state) => state.status === "complete").length;
  const terminal = input.states.filter((state) => state.status === "partial" || state.status === "failed_terminal").length;
  return {
    jobPhase: "waiting_for_targeted_index",
    targetedIndex: {
      phase: "checking_candidate_windows",
      scoreValid: false,
      candidateWindows: {
        total: input.requests.length,
        queued: input.states.filter((state) => state.status === "queued").length,
        running: input.states.filter((state) => state.status === "running").length,
        complete,
        terminal,
        pending: Math.max(0, input.requests.length - complete - terminal)
      },
      broadFallback: "not_queued",
      windows: input.requests.map((request) => ({
        address: request.address,
        targetTimestamp: request.targetTimestamp.toISOString(),
        windowStartTimestamp: request.windowStartTimestamp.toISOString(),
        windowEndTimestamp: request.windowEndTimestamp.toISOString(),
        relatedHopTxHash: request.relatedHopTxHash,
        candidateTxHash: request.candidateTxHash,
        coverageShare: request.coverageShare
      }))
    }
  };
}

export async function ensureCandidateWindowsOrWait(input: CandidateWindowWaitInput): Promise<true> {
  if (input.requests.length === 0) return true;
  const states: TronAddressUsdtIndexState[] = [];
  for (const request of input.requests) {
    const existing = await input.deps.getAddressUsdtIndexState({
      address: request.address,
      coverageMode: "targeted",
      requestKind: "candidate_window",
      targetTimestamp: request.targetTimestamp,
      windowStartTimestamp: request.windowStartTimestamp,
      windowEndTimestamp: request.windowEndTimestamp,
      candidateTxHash: request.candidateTxHash
    });
    const state = existing && isTargetedHistoryFinished(existing)
      ? existing
      : await input.deps.queueAddressUsdtHistory({
          address: request.address,
          coverageMode: "targeted",
          requestKind: "candidate_window",
          targetTimestamp: request.targetTimestamp,
          windowStartTimestamp: request.windowStartTimestamp,
          windowEndTimestamp: request.windowEndTimestamp,
          relatedHopTxHash: request.relatedHopTxHash,
          candidateTxHash: request.candidateTxHash,
          requestedByJobId: input.jobId,
          queuedReason: "where_candidate_window",
          budgetPages: 200,
          maxAttempts: 3
        });
    states.push(state);
    if (!isTargetedHistoryFinished(state)) {
      await input.deps.upsertForensicJobWait?.({
        jobId: input.jobId,
        address: request.address,
        targetTimestamp: request.targetTimestamp,
        requestKind: "candidate_window",
        windowStartTimestamp: request.windowStartTimestamp,
        windowEndTimestamp: request.windowEndTimestamp,
        relatedHopTxHash: request.relatedHopTxHash,
        candidateTxHash: request.candidateTxHash,
        requiredFor: "where_hop",
        statusReason: state.statusReason,
        lastError: state.lastError
      });
    }
  }
  if (states.every(isTargetedHistoryFinished)) return true;
  const persisted = await input.persistProgress(candidateWindowWaitingProgressPatch({
    requests: input.requests,
    states
  }));
  const released = await input.deps.releaseForensicCheckJobToWaiting({
    id: input.jobId,
    progressJson: persisted ?? input.progressJson,
    lastError: null
  });
  if (!released) throw new Error("candidate_window_wait_release_failed");
  const afterReleaseStates = await Promise.all(input.requests.map((request) => input.deps.getAddressUsdtIndexState({
    address: request.address,
    coverageMode: "targeted",
    requestKind: "candidate_window",
    targetTimestamp: request.targetTimestamp,
    windowStartTimestamp: request.windowStartTimestamp,
    windowEndTimestamp: request.windowEndTimestamp,
    candidateTxHash: request.candidateTxHash
  })));
  for (const state of afterReleaseStates) {
    if (state && isTargetedHistoryFinished(state)) {
      await input.deps.markWaitingForensicJobsReadyAfterTargetedIndex?.({
        address: state.address,
        targetTimestamp: state.targetTimestamp,
        requestKind: "candidate_window",
        windowStartTimestamp: state.windowStartTimestamp ?? null,
        windowEndTimestamp: state.windowEndTimestamp ?? null,
        relatedHopTxHash: state.relatedHopTxHash ?? null,
        candidateTxHash: state.candidateTxHash ?? null,
        indexStatus: state.status,
        statusReason: state.statusReason,
        lastError: state.lastError,
        state
      });
    }
  }
  throw new TargetedHistoryWaitingForIndex();
}

function isTargetedHistoryAlreadyInFlight(state: TronAddressUsdtIndexState | null | undefined): boolean {
  return state?.coverageMode === "targeted" &&
    (state.status === "queued" || state.status === "running" || state.status === "failed_retryable");
}

export function targetedHistoryTerminalStatus(
  statusReason: TronAddressUsdtCoverageStatusReason | null | undefined,
  lastError?: string | null
): { scoreBlockedReason: ForensicScoreBlockedReason; technicalStatus: ForensicTechnicalStatus } {
  const errorText = (lastError ?? "").toLowerCase();
  if (statusReason === "partial_rate_limited" || errorText.includes("429") || errorText.includes("rate")) {
    return { scoreBlockedReason: "rate_limited_after_retries", technicalStatus: "provider_limited" };
  }
  if (statusReason === "partial_provider_inconsistent") {
    return { scoreBlockedReason: "provider_inconsistent", technicalStatus: "provider_error" };
  }
  if (statusReason === "partial_provider_cap") {
    return { scoreBlockedReason: "provider_cap_unresolved", technicalStatus: "provider_cap_unresolved" };
  }
  if (statusReason === "too_large_deferred") {
    return { scoreBlockedReason: "hard_safety_limit_exceeded", technicalStatus: "hard_safety_limit_exceeded" };
  }
  if (statusReason === "partial_budget_exhausted") {
    return { scoreBlockedReason: "partial_budget_exhausted", technicalStatus: "budget_limited" };
  }
  return { scoreBlockedReason: "provider_error", technicalStatus: "provider_error" };
}

function isTargetedHistoryCovered(state: TronAddressUsdtIndexState | null | undefined): boolean {
  return state?.coverageMode === "targeted" &&
    state.status === "complete" &&
    state.statusReason === "complete_provider_windowed";
}

function isTargetedHistoryFinished(state: TronAddressUsdtIndexState): boolean {
  return state.status === "complete" || state.status === "failed_terminal" || isTerminalPartialState(state);
}

function throwIfTerminal(state: TronAddressUsdtIndexState | null | undefined, maxRetryBudgetPages?: number | null): void {
  if (!state) return;
  if (state.status === "failed_terminal" || isTerminalPartialState(state, maxRetryBudgetPages)) {
    const mapped = targetedHistoryTerminalStatus(state.statusReason, state.lastError);
    throw new TargetedHistoryTerminalError({
      message: `targeted_history_terminal:${state.status}:${state.statusReason ?? "unknown"}`,
      ...mapped
    });
  }
}

function isTerminalPartialState(state: TronAddressUsdtIndexState, maxRetryBudgetPages?: number | null): boolean {
  if (state.status !== "partial") return false;
  if (isRetryablePartialState(state, maxRetryBudgetPages)) return false;
  if (state.statusReason === "partial_provider_inconsistent" ||
    state.statusReason === "too_large_deferred" ||
    state.statusReason === "failed_terminal") {
    return true;
  }
  if (state.statusReason === "partial_budget_exhausted" || state.statusReason === "partial_rate_limited") {
    return true;
  }
  if (state.statusReason === "partial_provider_cap") {
    return state.attemptCount >= Math.max(state.maxAttempts, TARGETED_HISTORY_MIN_MAX_ATTEMPTS);
  }
  return false;
}

function isRetryablePartialState(
  state: TronAddressUsdtIndexState | null | undefined,
  maxRetryBudgetPages?: number | null
): boolean {
  if (state?.coverageMode !== "targeted" || state.status !== "partial") return false;
  if (state.statusReason === "partial_rate_limited") {
    return state.attemptCount < Math.max(state.maxAttempts, TARGETED_HISTORY_MIN_MAX_ATTEMPTS);
  }
  if (state.statusReason === "partial_budget_exhausted") {
    return retryBudgetCanGrow(state, maxRetryBudgetPages);
  }
  return state.statusReason === "partial_provider_cap" &&
    state.budgetExhausted === true &&
    retryBudgetCanGrow(state, maxRetryBudgetPages);
}

function nextRetryablePartialBudgetPages(
  state: TronAddressUsdtIndexState,
  maxRetryBudgetPages?: number | null
): number {
  const current = Math.max(
    TARGETED_HISTORY_RETRY_MIN_BUDGET_PAGES,
    state.budgetPages ?? 0,
    state.fetchedPageCount ?? 0
  );
  if (state.statusReason === "partial_rate_limited") {
    const max = normalizedRetryBudgetCeiling(maxRetryBudgetPages);
    return max === null ? current : Math.min(max, current);
  }
  const next = current * TARGETED_HISTORY_RETRY_ESCALATION_FACTOR;
  const max = normalizedRetryBudgetCeiling(maxRetryBudgetPages);
  return max === null ? next : Math.min(max, next);
}

function nextRetryablePartialMaxAttempts(state: TronAddressUsdtIndexState): number {
  if (state.statusReason === "partial_rate_limited") {
    return Math.max(state.maxAttempts, TARGETED_HISTORY_MIN_MAX_ATTEMPTS);
  }
  return Math.max(state.maxAttempts, TARGETED_HISTORY_MIN_MAX_ATTEMPTS, state.attemptCount + 1);
}

function retryBudgetCanGrow(
  state: TronAddressUsdtIndexState,
  maxRetryBudgetPages?: number | null
): boolean {
  const current = Math.max(state.budgetPages ?? 0, state.fetchedPageCount ?? 0);
  return nextRetryablePartialBudgetPages(state, maxRetryBudgetPages) > current;
}

function normalizedRetryBudgetCeiling(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(1, Math.floor(value));
}

function targetedIndexStateProgress(
  state: TronAddressUsdtIndexState | null | undefined,
  lastError = state?.lastError ?? null
): Record<string, unknown> {
  const errorText = (lastError ?? "").toLowerCase();
  const rateLimited = state?.statusReason === "partial_rate_limited" ||
    /\b(429|rate limit|too many requests)\b/i.test(errorText);
  const forbidden = /\b(403|forbidden)\b/i.test(errorText);
  const serverError = /\b5\d\d\b/i.test(errorText);
  return {
    pagesFetched: state?.fetchedPageCount ?? null,
    transfersFetched: state?.fetchedTransferCount ?? null,
    oldestFetchedTransferAt: state?.oldestTransferAt?.toISOString() ?? null,
    newestFetchedTransferAt: state?.newestTransferAt?.toISOString() ?? null,
    targetTimestamp: state?.targetTimestamp?.toISOString() ?? null,
    budgetPages: state?.budgetPages ?? null,
    attemptCount: state?.attemptCount ?? null,
    maxAttempts: state?.maxAttempts ?? null,
    retryCount: state?.retryCount ?? null,
    providerCapHit: state?.providerCapHit ?? null,
    budgetExhausted: state?.budgetExhausted ?? null,
    providerInconsistent: state?.providerInconsistent ?? null,
    requestCount: state?.fetchedPageCount ?? null,
    rateLimitedCount: rateLimited ? 1 : 0,
    forbiddenCount: forbidden ? 1 : 0,
    serverErrorCount: serverError ? 1 : 0
  };
}
