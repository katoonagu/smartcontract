import type { WaitReconciliationResultV1 } from "../types";

export type ForensicRuntimeOrchestration = {
  runVerifiedStartup(): Promise<void>;
  runBeforeWherePoll(): Promise<void>;
  runBeforeIncomingPoll(): Promise<void>;
  runAfterTargetedIndexCompletion(): Promise<void>;
};

export function createForensicRuntimeOrchestration(input: {
  verifyStartupSchema(): Promise<unknown>;
  reconcileWaitingForensicJobs(): Promise<readonly WaitReconciliationResultV1[] | void>;
  logger?: { info(event: string, fields: Record<string, unknown>): void };
}): ForensicRuntimeOrchestration {
  let reconciliationTail = Promise.resolve();

  const reconcile = (): Promise<void> => {
    const cycle = reconciliationTail.then(async () => {
      const results = await input.reconcileWaitingForensicJobs();
      for (const result of results ?? []) {
        input.logger?.info("forensic_wait_reconciliation", {
          parentJobId: result.parentJobId,
          readyCount: result.readyCount,
          terminalCount: result.terminalCount,
          cancelledCount: result.cancelledCount,
          waitingCount: result.waitingCount,
          outcome: result.outcome,
          diagnosticCode: result.diagnosticCode
        });
      }
    });
    reconciliationTail = cycle.catch(() => undefined);
    return cycle;
  };

  return {
    runVerifiedStartup: async () => {
      await input.verifyStartupSchema();
      await reconcile();
    },
    runBeforeWherePoll: reconcile,
    runBeforeIncomingPoll: reconcile,
    runAfterTargetedIndexCompletion: reconcile
  };
}
