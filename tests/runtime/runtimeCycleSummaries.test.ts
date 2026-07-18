import { describe, expect, it } from "vitest";
import { runSingleApprovalAllowanceRefreshCycle } from "../../src/approvals/allowanceRefreshWorker";
import { runAddressIndexWorkerOnce } from "../../src/forensics/addressIndexWorker";
import { runSingleForensicTelegramDeliveryCycle } from "../../src/forensics/telegramDeliveryWorker";
import { createForensicRuntimeOrchestration } from "../../src/runtime/forensicRuntimeOrchestration";

describe("runtime cycle summaries", () => {
  it("proves an empty delivery queue through real bounded claim probes", async () => {
    let probes = 0;
    const result = await runSingleForensicTelegramDeliveryCycle({
      db: {},
      now: () => new Date("2026-07-19T10:00:00.000Z"),
      deliveryLimit: 3,
      recoveryLimit: 0,
      repository: {
        listDueRecoveredForensicDeliveryIntents: async () => [],
        settleRecoveredForensicDeliveryIntentPreparation: async () => false,
        attachRecoveredForensicTelegramDelivery: async () => false,
        claimNextForensicTelegramDelivery: async () => { probes += 1; return null; },
        settleForensicTelegramDelivery: async () => false
      },
      sendTelegram: async () => { throw new Error("empty queue must not send"); }
    });
    expect(probes).toBe(3);
    expect(result).toMatchObject({ claimProbeCount: 3, claimed: 0, sent: 0 });
  });

  it("returns typed empty allowance and address-index query summaries", async () => {
    const allowance = await runSingleApprovalAllowanceRefreshCycle({
      db: {},
      now: () => new Date("2026-07-19T10:00:00.000Z"),
      getUsdtAllowance: async () => "0",
      saveWalletApprovalAllowanceStateV2: async () => undefined,
      repository: {
        listDueApprovalAllowanceRefreshTargets: async () => [],
        tryAcquireApprovalAllowanceRefreshLock: async () => null
      }
    });
    expect(allowance).toEqual({ selected: 0, locked: 0, attempted: 0, completed: 0 });

    const addressIndex = await runAddressIndexWorkerOnce({
      claimQueuedTronAddressUsdtIndexStates: async () => [],
      ensureAddressUsdtHistory: async () => { throw new Error("no state"); },
      failTronAddressUsdtIndexState: async () => undefined
    }, { claimLimit: 3, lockMs: 1_000, workerId: "runtime-proof" });
    expect(addressIndex).toEqual({ claimed: 0, completed: 0, requeued: 0, failed: 0 });
  });

  it("returns a reconciliation summary after the repository path completes", async () => {
    const runtime = createForensicRuntimeOrchestration({
      reconcileWaitingForensicJobs: async () => [{
        parentJobId: "job-1",
        outcome: "resume_ready",
        readyCount: 1,
        terminalCount: 0,
        cancelledCount: 0,
        waitingCount: 0,
        diagnosticCode: null
      }]
    });
    await expect(runtime.runBeforeWherePoll()).resolves.toEqual({
      sourceQueryCompleted: true,
      examinedCount: 1,
      completedCount: 1
    });
  });
});
