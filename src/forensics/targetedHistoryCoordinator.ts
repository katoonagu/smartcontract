import type { ForensicJobProgressPatch } from "./forensicJobProgress";
import type {
  ForensicScoreBlockedReason,
  ForensicTechnicalStatus,
  TronAddressUsdtCoverageMode,
  TronAddressUsdtCoverageStatusReason,
  TronAddressUsdtIndexState
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
    requiredFor: TargetedHistoryRequiredFor;
    statusReason?: TronAddressUsdtCoverageStatusReason | null;
    lastError?: string | null;
  }): Promise<void>;
  markWaitingForensicJobsReadyAfterTargetedIndex?(input: {
    address: string;
    targetTimestamp: Date | null;
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
  progressJson: Record<string, unknown>;
  deps: TargetedHistoryWaiterDeps;
  persistProgress(patch: ForensicJobProgressPatch): Promise<Record<string, unknown> | void>;
  afterWaitingPatch?: ForensicJobProgressPatch;
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
  throwIfTerminal(existing);
  const covering = existing
    ? null
    : (await input.deps.getCoveringAddressUsdtIndexState?.({
        address: input.address,
        coverageMode: "targeted",
        targetTimestamp: input.targetTimestamp
      }) ?? null);
  if (isTargetedHistoryCovered(covering)) return true;
  throwIfTerminal(covering);

  const retryablePartial = existing && isRetryablePartialState(existing)
    ? existing
    : covering && isRetryablePartialState(covering)
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
          budgetPages: retryablePartial ? nextRetryablePartialBudgetPages(retryablePartial) : undefined,
          maxAttempts: retryablePartial ? nextRetryablePartialMaxAttempts(retryablePartial) : undefined
        });
  if (isTargetedHistoryCovered(queued)) return true;
  throwIfTerminal(queued);

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

function throwIfTerminal(state: TronAddressUsdtIndexState | null | undefined): void {
  if (!state) return;
  if (state.status === "failed_terminal" || isTerminalPartialState(state)) {
    const mapped = targetedHistoryTerminalStatus(state.statusReason, state.lastError);
    throw new TargetedHistoryTerminalError({
      message: `targeted_history_terminal:${state.status}:${state.statusReason ?? "unknown"}`,
      ...mapped
    });
  }
}

function isTerminalPartialState(state: TronAddressUsdtIndexState): boolean {
  if (state.status !== "partial") return false;
  if (isRetryablePartialState(state)) return false;
  if (state.statusReason === "partial_provider_inconsistent" ||
    state.statusReason === "too_large_deferred" ||
    state.statusReason === "failed_terminal") {
    return true;
  }
  if (state.statusReason === "partial_provider_cap") {
    return state.attemptCount >= Math.max(state.maxAttempts, TARGETED_HISTORY_MIN_MAX_ATTEMPTS);
  }
  return false;
}

function isRetryablePartialState(state: TronAddressUsdtIndexState | null | undefined): boolean {
  if (state?.coverageMode !== "targeted" || state.status !== "partial") return false;
  if (state.statusReason === "partial_budget_exhausted" || state.statusReason === "partial_rate_limited") return true;
  return state.statusReason === "partial_provider_cap" && state.budgetExhausted === true;
}

function nextRetryablePartialBudgetPages(state: TronAddressUsdtIndexState): number {
  const current = Math.max(
    TARGETED_HISTORY_RETRY_MIN_BUDGET_PAGES,
    state.budgetPages ?? 0,
    state.fetchedPageCount ?? 0
  );
  return current * TARGETED_HISTORY_RETRY_ESCALATION_FACTOR;
}

function nextRetryablePartialMaxAttempts(state: TronAddressUsdtIndexState): number {
  return Math.max(state.maxAttempts, TARGETED_HISTORY_MIN_MAX_ATTEMPTS, state.attemptCount + 1);
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
