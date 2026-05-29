import { describe, expect, it, vi } from "vitest";
import type { ForensicCheckJob } from "../../src/storage/repositories";
import { runSingleIncomingDepositJobCycle } from "../../src/forensics/incomingDepositJob";
import type { IncomingDepositRiskReport } from "../../src/types";

const depositTxHash = "48d33ccf504fd97aa741dcbc2e4cccb7225e1bf7859b64d385a338df91ce0c3b";
const watchedWalletId = "wallet-1";

const validProgressJson = {
  depositTxHash,
  watchedWallet: "TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM",
  watchedWalletId,
  sender: "TEaViAxT9H9WkUSCV9mMnM3DTVWRacfdKs",
  amountRaw: "384064001319",
  amount: "384064.001319",
  timestamp: "2026-05-29T14:01:00.000Z",
  telegramUserId: "42",
  alertMode: "realtime"
};

function report(overrides: Partial<IncomingDepositRiskReport> = {}): IncomingDepositRiskReport {
  return {
    decision: "ACCEPTABLE",
    depositRiskScore: 32,
    riskBand: "LOW-MEDIUM",
    fastSenderRisk: null,
    originPaths: [],
    originCoverage: 0.72,
    provenanceConfidence: 58,
    dataQuality: "medium",
    senderRole: "operational_liquidity_wallet",
    hardBadEvidence: [],
    contractVerdicts: [],
    reasons: ["Sender looks operational."],
    warnings: [],
    ...overrides
  };
}

function job(progressJson: Record<string, unknown>): ForensicCheckJob {
  return {
    id: "job-incoming-1",
    kind: "incoming_deposit_check",
    subjectAddress: "TEaViAxT9H9WkUSCV9mMnM3DTVWRacfdKs",
    status: "running",
    windowStart: new Date("2026-05-29T13:00:00.000Z"),
    windowEnd: new Date("2026-05-29T14:02:00.000Z"),
    priority: 140,
    chatId: "42",
    messageId: null,
    requestedBy: "42",
    progressJson,
    resultJson: {},
    rawEvidenceIds: [],
    observationIds: [],
    lastError: null,
    createdAt: new Date("2026-05-29T14:02:00.000Z"),
    updatedAt: new Date("2026-05-29T14:02:00.000Z"),
    startedAt: new Date("2026-05-29T14:02:01.000Z"),
    completedAt: null
  };
}

describe("runSingleIncomingDepositJobCycle", () => {
  it("completes an incoming deposit job and sends one final alert", async () => {
    const events: string[] = [];
    const complete = vi.fn(async (input: { status: string }) => {
      events.push(`complete:${input.status}`);
      return true;
    });
    const send = vi.fn(async () => {
      events.push("send");
    });
    const markSent = vi.fn(async () => {
      events.push("markSent");
      return true;
    });

    const handled = await runSingleIncomingDepositJobCycle({
      claimNextForensicCheckJob: async () => job(validProgressJson),
      completeForensicCheckJob: complete,
      markUserAlertSent: markSent,
      markUserAlertFailed: async () => true,
      recordObservedTransactionRisk: async () => true,
      sendUserAlert: send,
      formatIncomingDepositRiskAlert: () => ({
        text: "<b>Incoming USDT</b>",
        parseMode: "HTML",
        replyMarkup: undefined
      }),
      buildReport: async () => report()
    });

    expect(handled).toBe(true);
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ status: "completed" }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(markSent).toHaveBeenCalledWith({
      txHash: depositTxHash,
      watchedWalletId
    });
    expect(events).toEqual(["send", "markSent", "complete:completed"]);
  });

  it("finalizes risk_only acceptable deposits without sending a Telegram alert", async () => {
    const complete = vi.fn(async () => true);
    const send = vi.fn(async () => undefined);
    const markSent = vi.fn(async () => true);
    const recordRisk = vi.fn(async () => true);

    const handled = await runSingleIncomingDepositJobCycle({
      claimNextForensicCheckJob: async () => job({ ...validProgressJson, alertMode: "risk_only" }),
      completeForensicCheckJob: complete,
      markUserAlertSent: markSent,
      markUserAlertFailed: async () => true,
      recordObservedTransactionRisk: recordRisk,
      sendUserAlert: send,
      formatIncomingDepositRiskAlert: () => ({
        text: "<b>Incoming USDT</b>",
        parseMode: "HTML"
      }),
      buildReport: async () => report({ decision: "ACCEPTABLE" })
    });

    expect(handled).toBe(true);
    expect(recordRisk).toHaveBeenCalledWith(expect.objectContaining({ txHash: depositTxHash, watchedWalletId }));
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ status: "completed" }));
    expect(send).not.toHaveBeenCalled();
    expect(markSent).toHaveBeenCalledWith({ txHash: depositTxHash, watchedWalletId });
  });

  it("fails jobs missing required progress_json fields without building or sending", async () => {
    const complete = vi.fn(async () => true);
    const buildReport = vi.fn(async () => report());
    const send = vi.fn(async () => undefined);
    const markSent = vi.fn(async () => true);

    const handled = await runSingleIncomingDepositJobCycle({
      claimNextForensicCheckJob: async () => job({
        ...validProgressJson,
        depositTxHash: undefined
      }),
      completeForensicCheckJob: complete,
      markUserAlertSent: markSent,
      markUserAlertFailed: async () => true,
      recordObservedTransactionRisk: async () => true,
      sendUserAlert: send,
      formatIncomingDepositRiskAlert: () => ({
        text: "<b>Incoming USDT</b>",
        parseMode: "HTML"
      }),
      buildReport
    });

    expect(handled).toBe(true);
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed",
      lastError: expect.stringContaining("missing required progress_json fields")
    }));
    expect(buildReport).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(markSent).not.toHaveBeenCalled();
  });

  it("marks the observed alert failed and fails the job when report building throws", async () => {
    const complete = vi.fn(async () => true);
    const markFailed = vi.fn(async () => true);

    const handled = await runSingleIncomingDepositJobCycle({
      claimNextForensicCheckJob: async () => job(validProgressJson),
      completeForensicCheckJob: complete,
      markUserAlertSent: async () => true,
      markUserAlertFailed: markFailed,
      recordObservedTransactionRisk: async () => true,
      sendUserAlert: async () => undefined,
      formatIncomingDepositRiskAlert: () => ({
        text: "<b>Incoming USDT</b>",
        parseMode: "HTML"
      }),
      buildReport: async () => {
        throw new Error("risk builder unavailable");
      }
    });

    expect(handled).toBe(true);
    expect(markFailed).toHaveBeenCalledWith({
      txHash: depositTxHash,
      watchedWalletId,
      error: "risk builder unavailable"
    });
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed",
      lastError: "risk builder unavailable"
    }));
  });

  it("records only a failed job state when Telegram delivery throws", async () => {
    const complete = vi.fn(async () => true);
    const markFailed = vi.fn(async () => true);

    const handled = await runSingleIncomingDepositJobCycle({
      claimNextForensicCheckJob: async () => job(validProgressJson),
      completeForensicCheckJob: complete,
      markUserAlertSent: async () => true,
      markUserAlertFailed: markFailed,
      recordObservedTransactionRisk: async () => true,
      sendUserAlert: async () => {
        throw new Error("telegram unavailable");
      },
      formatIncomingDepositRiskAlert: () => ({
        text: "<b>Incoming USDT</b>",
        parseMode: "HTML"
      }),
      buildReport: async () => report()
    });

    expect(handled).toBe(true);
    expect(markFailed).toHaveBeenCalledWith({
      txHash: depositTxHash,
      watchedWalletId,
      error: "telegram unavailable"
    });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed",
      lastError: "telegram unavailable"
    }));
  });
});
