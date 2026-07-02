import type { TronAddressUsdtCoverageMode, TronAddressUsdtIndexState } from "../types";

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
    }): Promise<TronAddressUsdtIndexState>;
    failTronAddressUsdtIndexState(input: {
      address: string;
      coverageMode: TronAddressUsdtCoverageMode;
      targetTimestamp?: Date | null;
      error: string;
      errorClass: AddressIndexErrorClass;
    }): Promise<void>;
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
      await deps.ensureAddressUsdtHistory({
        address: state.address,
        coverageMode: state.coverageMode,
        targetTimestamp: state.targetTimestamp,
        requestedByJobId: state.requestedByJobId,
        queuedReason: state.queuedReason ?? "background_index"
      });
    } catch (error) {
      await deps.failTronAddressUsdtIndexState({
        address: state.address,
        coverageMode: state.coverageMode,
        targetTimestamp: state.targetTimestamp,
        error: error instanceof Error ? error.message : String(error),
        errorClass: classifyAddressIndexError(error)
      });
    }
  }));
}
