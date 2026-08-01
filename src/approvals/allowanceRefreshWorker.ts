import { TRON_USDT_CONTRACT_ADDRESS } from "../parser/transactionParser";
import type { ApprovalAllowanceStateV2 } from "../types";
import { buildApprovalAllowanceRefreshState } from "./allowanceRefresh";

const ALLOWANCE_REFRESH_BATCH_LIMIT = 5;
const ALLOWANCE_REFRESH_TIMEOUT_MS = 15_000;
const EXPECTED_CAUSAL_WRITE_REJECTIONS = new Set([
  "allowance_state_not_current",
  "allowance_owner_binding_mismatch",
  "allowance_state_stale_write"
]);

export type ApprovalAllowanceRefreshTarget = {
  watchedWalletId: string;
  ownerAddress: string;
  tokenContract: string;
  spenderAddress: string;
};

export type ApprovalAllowanceRefreshRepository<Database> = {
  listDueApprovalAllowanceRefreshTargets(
    db: Database,
    input: { now: Date; limit: number }
  ): Promise<ApprovalAllowanceRefreshTarget[]>;
  tryAcquireApprovalAllowanceRefreshLock(
    db: Database,
    input: ApprovalAllowanceRefreshTarget & { now: Date }
  ): Promise<null | { release(): Promise<void> }>;
};

function isExpectedCausalWriteRejection(error: unknown): boolean {
  return error instanceof Error && EXPECTED_CAUSAL_WRITE_REJECTIONS.has(error.message);
}

async function getAllowanceWithTimeout(input: {
  ownerAddress: string;
  spenderAddress: string;
  getUsdtAllowance(request: {
    ownerAddress: string;
    spenderAddress: string;
    signal: AbortSignal;
  }): Promise<string>;
}): Promise<string> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timeoutError: Error | undefined;
  let provider: Promise<string> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = Object.assign(new Error("provider_timeout"), { name: "AbortError" });
      timeoutError = error;
      controller.abort(error);
      reject(error);
    }, ALLOWANCE_REFRESH_TIMEOUT_MS);
  });
  try {
    provider = input.getUsdtAllowance({
      ownerAddress: input.ownerAddress,
      spenderAddress: input.spenderAddress,
      signal: controller.signal
    });
    return await Promise.race([provider, timeout]);
  } catch (error) {
    if (timeoutError !== undefined && provider !== undefined) {
      try {
        await provider;
      } catch {
        // ponytail: provider cancellation details do not replace the 15s timeout result.
      }
      throw timeoutError;
    }
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function runSingleApprovalAllowanceRefreshCycle<Database>(deps: {
  db: Database;
  now(): Date;
  getUsdtAllowance(input: {
    ownerAddress: string;
    spenderAddress: string;
    signal: AbortSignal;
  }): Promise<string>;
  saveWalletApprovalAllowanceStateV2(input: {
    watchedWalletId: string;
    allowance: ApprovalAllowanceStateV2;
  }): Promise<void>;
  repository: ApprovalAllowanceRefreshRepository<Database>;
}): Promise<{ selected: number; locked: number; attempted: number; completed: number }> {
  const cycleNow = deps.now();
  const targets = await deps.repository.listDueApprovalAllowanceRefreshTargets(deps.db, {
    now: cycleNow,
    limit: ALLOWANCE_REFRESH_BATCH_LIMIT
  });
  const result = { selected: targets.length, locked: 0, attempted: 0, completed: 0 };

  for (const target of targets.slice(0, ALLOWANCE_REFRESH_BATCH_LIMIT)) {
    if (target.tokenContract !== TRON_USDT_CONTRACT_ADDRESS) continue;
    const attemptedAt = deps.now();
    const lock = await deps.repository.tryAcquireApprovalAllowanceRefreshLock(deps.db, { ...target, now: attemptedAt });
    if (!lock) continue;
    result.locked += 1;
    try {
      result.attempted += 1;
      const allowance = await buildApprovalAllowanceRefreshState({
        client: {
          getUsdtAllowance: () => getAllowanceWithTimeout({
            ownerAddress: target.ownerAddress,
            spenderAddress: target.spenderAddress,
            getUsdtAllowance: deps.getUsdtAllowance
          })
        },
        ownerAddress: target.ownerAddress,
        spenderAddress: target.spenderAddress,
        observedApprovalTxHash: null,
        now: attemptedAt,
        completionNow: deps.now,
        reason: "background_stale_refresh"
      });
      await deps.saveWalletApprovalAllowanceStateV2({
        watchedWalletId: target.watchedWalletId,
        allowance
      });
      result.completed += 1;
    } catch (error) {
      if (!isExpectedCausalWriteRejection(error)) throw error;
      result.completed += 1;
    } finally {
      await lock.release();
    }
  }
  return result;
}
