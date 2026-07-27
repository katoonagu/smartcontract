import { createPendingForensicTelegramDelivery } from "../forensics/telegramDelivery";
import { randomUUID } from "node:crypto";
import {
  runSingleForensicTelegramDeliveryCycle,
  type ForensicTelegramDeliveryRepository
} from "../forensics/telegramDeliveryWorker";
import type { Db } from "../storage/db";
import {
  attachRecoveredForensicTelegramDelivery,
  claimNextForensicCheckJob,
  claimNextForensicTelegramDelivery,
  completeForensicCheckJob,
  listDueRecoveredForensicDeliveryIntents,
  reconcileWaitingForensicCheckJobs,
  settleForensicTelegramDelivery,
  settleRecoveredForensicDeliveryIntentPreparation,
  type ForensicCheckJob
} from "../storage/repositories";
import type {
  TelegramDeliveryEffectV1,
  TelegramMessagePayloadV1,
  WaitReconciliationResultV1
} from "../types";
import type { RuntimeCycleWorkSummary } from "./runtimeLiveProof";
import {
  createPostgresUnifiedDeliveryRepository,
  runUnifiedDeliveryCycle,
  type UnifiedTelegramSendResult
} from "../unifiedCheck/delivery";

export type ForensicRuntimeOrchestration = {
  runVerifiedStartup(): Promise<void>;
  runBeforeWherePoll(): Promise<RuntimeCycleWorkSummary>;
  runBeforeIncomingPoll(): Promise<RuntimeCycleWorkSummary>;
  runAfterTargetedIndexCompletion(): Promise<RuntimeCycleWorkSummary>;
  runForensicCycle(): Promise<void>;
  runDeliveryCycle(): Promise<void>;
  runUnifiedDeliveryCycle(): Promise<void>;
};

type ScenarioCompletion = {
  status: "completed" | "partial" | "failed";
  progressJson: Record<string, unknown>;
  resultJson: Record<string, unknown>;
  rawEvidenceIds: string[];
  observationIds: string[];
  lastError: string | null;
  telegramPayload: TelegramMessagePayloadV1 | null;
  telegramEffect: TelegramDeliveryEffectV1;
};

type ForensicRuntimeOrchestrationInput = {
  verifyStartupSchema?(): Promise<unknown>;
  reconcileWaitingForensicJobs?(): Promise<readonly WaitReconciliationResultV1[] | void>;
  runForensicTelegramDeliveryCycle?(): Promise<void>;
  runApprovalAllowanceRefreshCycle?(): Promise<void>;
  runWhereCycle?(): Promise<void>;
  logger?: {
    info(event: string, fields: Record<string, unknown>): void;
    warn?(event: string, fields: Record<string, unknown>): void;
  };
  db?: Db;
  now?: () => Date;
  reconciliationLimit?: number;
  forensicClaimLimit?: number;
  deliveryLimit?: number;
  buildClaimedJobCompletion?(job: ForensicCheckJob): ScenarioCompletion | Promise<ScenarioCompletion>;
  sendTelegram?(
    payload: TelegramMessagePayloadV1,
    signal: AbortSignal
  ): Promise<{ telegramMessageId: string } | void>;
  sendUnifiedTelegram?(input: {
    chatId: string;
    messageThreadId: string;
    payload: { text: string; parseMode: "HTML" };
  }): Promise<UnifiedTelegramSendResult>;
};

const deliveryRepository: ForensicTelegramDeliveryRepository<Db> = {
  listDueRecoveredForensicDeliveryIntents,
  settleRecoveredForensicDeliveryIntentPreparation,
  attachRecoveredForensicTelegramDelivery,
  claimNextForensicTelegramDelivery,
  settleForensicTelegramDelivery
};

function positiveLimit(value: number | undefined, fallback: number, maximum: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value as number), 1), maximum);
}

export function createForensicRuntimeOrchestration(
  input: ForensicRuntimeOrchestrationInput
): ForensicRuntimeOrchestration {
  let reconciliationTail = Promise.resolve();

  const reconcile = (): Promise<RuntimeCycleWorkSummary> => {
    const cycle = reconciliationTail.then(async () => {
      const results = input.reconcileWaitingForensicJobs
        ? await input.reconcileWaitingForensicJobs()
        : input.db
          ? await reconcileWaitingForensicCheckJobs(input.db, {
              now: input.now?.() ?? new Date(),
              limit: positiveLimit(input.reconciliationLimit, 100, 100)
            })
          : [];
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
      const examinedCount = results?.length ?? 0;
      return { sourceQueryCompleted: true as const, examinedCount, completedCount: examinedCount };
    });
    reconciliationTail = cycle.then(() => undefined, () => undefined);
    return cycle;
  };

  const runScenarioForensicCycle = async (): Promise<void> => {
    if (input.runWhereCycle) {
      await input.runWhereCycle();
      return;
    }
    if (!input.db || !input.buildClaimedJobCompletion) return;
    await reconcile();
    const limit = positiveLimit(input.forensicClaimLimit, 1, 10);
    for (let index = 0; index < limit; index += 1) {
      const job = await claimNextForensicCheckJob(input.db, {
        kinds: ["where_is_money_check", "incoming_deposit_check"]
      });
      if (!job) break;
      if (job.kind === "address_fast_check") {
        throw new Error("address_fast_check cannot be claimed by forensic orchestration");
      }
      if (!job.startedAt) {
        throw new Error("claimed_forensic_job_missing_started_at");
      }
      const completion = await input.buildClaimedJobCompletion(job);
      const telegramDelivery = completion.telegramPayload
        ? createPendingForensicTelegramDelivery({
            jobId: job.id,
            kind: job.kind,
            payload: completion.telegramPayload,
            effect: completion.telegramEffect
          })
        : null;
      const completed = await completeForensicCheckJob(input.db, {
        id: job.id,
        claimStartedAt: job.startedAt,
        status: completion.status,
        progressJson: telegramDelivery
          ? { ...completion.progressJson, telegramDelivery }
          : completion.progressJson,
        resultJson: completion.resultJson,
        rawEvidenceIds: completion.rawEvidenceIds,
        observationIds: completion.observationIds,
        lastError: completion.lastError
      });
      if (!completed) {
        input.logger?.warn?.("lost_forensic_job_claim", { jobId: job.id });
      }
    }
  };

  const runDeliveryCycle = async (): Promise<void> => {
    if (input.runForensicTelegramDeliveryCycle) {
      await input.runForensicTelegramDeliveryCycle();
      return;
    }
    if (!input.db || !input.sendTelegram) return;
    await runSingleForensicTelegramDeliveryCycle({
      db: input.db,
      now: input.now ?? (() => new Date()),
      repository: deliveryRepository,
      recoveryLimit: 10,
      deliveryLimit: input.deliveryLimit,
      sendTelegram: input.sendTelegram,
      logger: input.logger
    });
  };

  const runUnifiedWalletDeliveryCycle = async (): Promise<void> => {
    if (!input.db || !input.sendUnifiedTelegram) return;
    await runUnifiedDeliveryCycle({
      repository: createPostgresUnifiedDeliveryRepository(input.db),
      now: input.now ?? (() => new Date()),
      leaseToken: randomUUID,
      leaseMs: 30_000,
      limit: positiveLimit(input.deliveryLimit, 1, 10),
      sendTelegram: input.sendUnifiedTelegram
    });
  };

  return {
    runVerifiedStartup: async () => {
      if (input.verifyStartupSchema) await input.verifyStartupSchema();
      await reconcile();
      await runDeliveryCycle();
      await runUnifiedWalletDeliveryCycle();
      if (input.runApprovalAllowanceRefreshCycle) {
        await input.runApprovalAllowanceRefreshCycle();
      }
    },
    runBeforeWherePoll: reconcile,
    runBeforeIncomingPoll: reconcile,
    runAfterTargetedIndexCompletion: reconcile,
    runForensicCycle: runScenarioForensicCycle,
    runDeliveryCycle,
    runUnifiedDeliveryCycle: runUnifiedWalletDeliveryCycle
  };
}
