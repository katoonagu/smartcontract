import { describe, expect, it, vi } from "vitest";
import { TRON_USDT_CONTRACT_ADDRESS, type RawTronscanTrc20Transfer } from "../../src/parser/transactionParser";
import type { ForensicCheckJob } from "../../src/storage/repositories";
import {
  buildIncomingDepositReport,
  runSingleIncomingDepositJobCycle,
  type BuildIncomingDepositReportInput,
  type IncomingDepositRuntimeDeps
} from "../../src/forensics/incomingDepositJob";
import {
  createFixtureCrossChainDiscoveryProvider,
  type CrossChainDiscoveryProvider,
  type CrossChainTransfer,
  type ProviderRiskSnapshot
} from "../../src/forensics/crossChainProviders";
import type {
  EvmEvidenceProvider,
  EvmInternalTransaction,
  EvmLog,
  EvmTokenMetadata,
  EvmTokenTransfer,
  EvmTransaction,
  EvmTransactionReceipt
} from "../../src/forensics/evmExplorerClient";
import type {
  AddressLabel,
  ContractLlmVerdictSummary,
  IncomingDepositRiskReport,
  IndexedTronUsdtTransfer,
  ServiceClassification,
  StablecoinRestrictionProfile
} from "../../src/types";

const depositTxHash = "48d33ccf504fd97aa741dcbc2e4cccb7225e1bf7859b64d385a338df91ce0c3b";
const watchedWalletId = "wallet-1";
const stage2BridgeSender = "TStage2Bridge111111111111111111111";
const stage2EthereumActor = "0x2222222222222222222222222222222222222222";
const stage2GaryActor = "0x3333333333333333333333333333333333333333";
const stage2SanctionedActor = "0x5555555555555555555555555555555555555555";
const stage2UniswapV3Npm = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";
const stage2DecreaseLiquidityTopic = "0x26f6a8ec6d85944b0b35836d2ca9c7468e4bf0b1f2a1c23f0b6d3c673dbc8f2";

const validProgressJson = {
  depositTxHash,
  watchedWallet: "TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM",
  watchedWalletId,
  sender: "TEaViAxT9H9WkUSCV9mMnM3DTVWRacfdKs",
  amountRaw: "384064001319",
  amount: "384064.001319",
  timestamp: "2026-05-29T14:01:00.000Z",
  telegramUserId: "42",
  alertMode: "realtime",
  locale: "en"
};

function report(overrides: Partial<IncomingDepositRiskReport> = {}): IncomingDepositRiskReport {
  return {
    decision: "ACCEPTABLE",
    depositRiskScore: 32,
    riskBand: "LOW-MEDIUM",
    fastSenderRisk: null,
    originPaths: [],
    originCoverage: 0.72,
    fundingCoverage: {
      depositFundingCoverageRatio: 0.72,
      cleanSourceCoverageRatio: 0,
      exactContinuityCoverageRatio: 0.72
    },
    corridorSummary: null,
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

function indexedTransfer(overrides: Partial<IndexedTronUsdtTransfer>): IndexedTronUsdtTransfer {
  return {
    txHash: "indexed-transfer",
    blockNumber: 1,
    blockTimestamp: new Date("2026-05-29T13:30:00.000Z"),
    eventIndex: 0,
    fromAddress: "TFunder111111111111111111111111111111",
    toAddress: validProgressJson.sender,
    amountRaw: "384064001319",
    method: "transfer",
    callerAddress: null,
    confirmed: true,
    contractRet: "SUCCESS",
    ...overrides
  };
}

function liveTransfer(overrides: Partial<RawTronscanTrc20Transfer>): RawTronscanTrc20Transfer {
  return {
    transaction_id: "live-transfer",
    from_address: "TFunder111111111111111111111111111111",
    to_address: validProgressJson.sender,
    quant: "384064001319",
    contract_address: TRON_USDT_CONTRACT_ADDRESS,
    confirmed: true,
    contractRet: "SUCCESS",
    block_ts: new Date("2026-05-29T13:30:00.000Z").getTime(),
    ...overrides
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
    const formatAlert = vi.fn(() => ({
      text: "<b>Incoming USDT</b>",
      parseMode: "HTML" as const,
      replyMarkup: undefined
    }));

    const handled = await runSingleIncomingDepositJobCycle({
      claimNextForensicCheckJob: async () => job(validProgressJson),
      completeForensicCheckJob: complete,
      markUserAlertSent: markSent,
      markUserAlertFailed: async () => true,
      recordObservedTransactionRisk: async () => true,
      sendUserAlert: send,
      formatIncomingDepositRiskAlert: formatAlert,
      buildReport: async () => report()
    });

    expect(handled).toBe(true);
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ status: "completed" }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(markSent).toHaveBeenCalledWith({
      txHash: depositTxHash,
      watchedWalletId
    });
    expect(formatAlert).toHaveBeenCalledWith(expect.objectContaining({
      timestamp: new Date("2026-05-29T14:01:00.000Z"),
      locale: "en"
    }));
    expect(events).toEqual(["send", "markSent", "complete:completed"]);
  });

  it("passes parsed progress fields into the report builder", async () => {
    const buildReport = vi.fn(async () => report());

    await runSingleIncomingDepositJobCycle({
      claimNextForensicCheckJob: async () => job(validProgressJson),
      completeForensicCheckJob: async () => true,
      markUserAlertSent: async () => true,
      markUserAlertFailed: async () => true,
      recordObservedTransactionRisk: async () => true,
      sendUserAlert: async () => undefined,
      formatIncomingDepositRiskAlert: () => ({
        text: "<b>Incoming USDT</b>",
        parseMode: "HTML"
      }),
      buildReport
    });

    expect(buildReport).toHaveBeenCalledWith(expect.objectContaining({
      depositTxHash: "48d33ccf504fd97aa741dcbc2e4cccb7225e1bf7859b64d385a338df91ce0c3b",
      watchedWallet: "TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM",
      sender: "TEaViAxT9H9WkUSCV9mMnM3DTVWRacfdKs",
      amountRaw: "384064001319",
      timestamp: new Date("2026-05-29T14:01:00.000Z")
    }));
  });

  it("warns when an incoming deposit stage exceeds the slow-stage threshold", async () => {
    let currentMs = 0;
    const warnings: Array<{ event: string; fields: Record<string, unknown> | undefined }> = [];

    await runSingleIncomingDepositJobCycle({
      claimNextForensicCheckJob: async () => job(validProgressJson),
      completeForensicCheckJob: async () => true,
      markUserAlertSent: async () => true,
      markUserAlertFailed: async () => true,
      recordObservedTransactionRisk: async () => true,
      sendUserAlert: async () => undefined,
      formatIncomingDepositRiskAlert: () => ({
        text: "<b>Incoming USDT</b>",
        parseMode: "HTML"
      }),
      buildReport: async () => {
        currentMs += 31_000;
        return report();
      },
      timingClock: {
        nowMs: () => currentMs
      },
      now: () => new Date("2026-05-29T14:02:05.000Z"),
      logger: {
        info: () => {},
        warn: (event, fields) => warnings.push({ event, fields }),
        error: () => {}
      }
    });

    expect(warnings).toContainEqual({
      event: "incoming_deposit_stage_slow",
      fields: expect.objectContaining({
        job_id: "job-incoming-1",
        stage: "build_report",
        duration_ms: 31000
      })
    });
  });

  it("does not warn when incoming deposit stages stay under the slow-stage threshold", async () => {
    let currentMs = 0;
    const warnings: Array<{ event: string; fields: Record<string, unknown> | undefined }> = [];

    await runSingleIncomingDepositJobCycle({
      claimNextForensicCheckJob: async () => job(validProgressJson),
      completeForensicCheckJob: async () => true,
      markUserAlertSent: async () => true,
      markUserAlertFailed: async () => true,
      recordObservedTransactionRisk: async () => true,
      sendUserAlert: async () => undefined,
      formatIncomingDepositRiskAlert: () => ({
        text: "<b>Incoming USDT</b>",
        parseMode: "HTML"
      }),
      buildReport: async () => {
        currentMs += 29_999;
        return report();
      },
      timingClock: {
        nowMs: () => currentMs
      },
      now: () => new Date("2026-05-29T14:02:05.000Z"),
      logger: {
        info: () => {},
        warn: (event, fields) => warnings.push({ event, fields }),
        error: () => {}
      }
    });

    expect(warnings).toEqual([]);
  });

  it("ignores errors thrown by logger.warn for slow-stage warnings and still completes successfully", async () => {
    let currentMs = 0;
    const infos: Array<{ event: string; fields: Record<string, unknown> | undefined }> = [];
    let warnCallCount = 0;

    const complete = vi.fn(async () => true);

    const handled = await runSingleIncomingDepositJobCycle({
      claimNextForensicCheckJob: async () => job(validProgressJson),
      completeForensicCheckJob: complete,
      markUserAlertSent: async () => true,
      markUserAlertFailed: async () => true,
      recordObservedTransactionRisk: async () => true,
      sendUserAlert: async () => undefined,
      formatIncomingDepositRiskAlert: () => ({
        text: "<b>Incoming USDT</b>",
        parseMode: "HTML"
      }),
      buildReport: async () => {
        currentMs += 31_000;
        return report();
      },
      timingClock: {
        nowMs: () => currentMs
      },
      now: () => new Date("2026-05-29T14:02:05.000Z"),
      logger: {
        info: (event, fields) => infos.push({ event, fields }),
        warn: () => {
          warnCallCount += 1;
          throw new Error("warn failed");
        },
        error: () => {}
      }
    });

    expect(handled).toBe(true);
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ status: "completed" }));
    expect(warnCallCount).toBeGreaterThan(0);
    expect(infos.some((entry) => entry.event === "incoming_deposit_job_timing")).toBe(true);
  });

  it("uses the default logger for slow-stage warning when no logger is provided", async () => {
    let currentMs = 0;
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const defaultLoggerWarnings: unknown[] = [];

    consoleWarn.mockImplementation((message: unknown) => {
      defaultLoggerWarnings.push(message);
    });

    try {
      await runSingleIncomingDepositJobCycle({
        claimNextForensicCheckJob: async () => job(validProgressJson),
        completeForensicCheckJob: async () => true,
        markUserAlertSent: async () => true,
        markUserAlertFailed: async () => true,
        recordObservedTransactionRisk: async () => true,
        sendUserAlert: async () => undefined,
        formatIncomingDepositRiskAlert: () => ({
          text: "<b>Incoming USDT</b>",
          parseMode: "HTML"
        }),
        buildReport: async () => {
          currentMs += 31_000;
          return report();
        },
        timingClock: {
          nowMs: () => currentMs
        },
        now: () => new Date("2026-05-29T14:02:05.000Z")
      });
    } finally {
      consoleWarn.mockRestore();
    }

    expect(defaultLoggerWarnings.some((message) =>
      typeof message === "string" && message.includes("incoming_deposit_stage_slow")
    )).toBe(true);
  });

  it("ignores final timing info logger failures and still resolves successfully", async () => {
    let currentMs = 0;
    let infoCallCount = 0;
    const complete = vi.fn(async () => true);

    const handled = await runSingleIncomingDepositJobCycle({
      claimNextForensicCheckJob: async () => job(validProgressJson),
      completeForensicCheckJob: complete,
      markUserAlertSent: async () => true,
      markUserAlertFailed: async () => true,
      recordObservedTransactionRisk: async () => true,
      sendUserAlert: async () => undefined,
      formatIncomingDepositRiskAlert: () => ({
        text: "<b>Incoming USDT</b>",
        parseMode: "HTML"
      }),
      buildReport: async () => {
        currentMs += 1_000;
        return report();
      },
      timingClock: {
        nowMs: () => currentMs
      },
      now: () => new Date("2026-05-29T14:02:05.000Z"),
      logger: {
        info: () => {
          infoCallCount += 1;
          throw new Error("info failed");
        },
        warn: () => {},
        error: () => {}
      }
    });

    expect(handled).toBe(true);
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ status: "completed" }));
    expect(infoCallCount).toBeGreaterThan(0);
  });

  it("ignores timing persist warning logger failures and still resolves successfully", async () => {
    let currentMs = 0;
    let warnCallCount = 0;
    const updateForensicCheckJobProgress = vi.fn(async () => false);
    const complete = vi.fn(async () => true);

    const handled = await runSingleIncomingDepositJobCycle({
      claimNextForensicCheckJob: async () => job(validProgressJson),
      completeForensicCheckJob: complete,
      updateForensicCheckJobProgress,
      markUserAlertSent: async () => true,
      markUserAlertFailed: async () => true,
      recordObservedTransactionRisk: async () => true,
      sendUserAlert: async () => undefined,
      formatIncomingDepositRiskAlert: () => ({
        text: "<b>Incoming USDT</b>",
        parseMode: "HTML"
      }),
      buildReport: async () => {
        currentMs += 1_000;
        return report();
      },
      timingClock: {
        nowMs: () => currentMs
      },
      now: () => new Date("2026-05-29T14:02:05.000Z"),
      logger: {
        info: () => {},
        warn: () => {
          warnCallCount += 1;
          throw new Error("warn failed");
        },
        error: () => {}
      }
    });

    expect(handled).toBe(true);
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ status: "completed" }));
    expect(updateForensicCheckJobProgress).toHaveBeenCalled();
    expect(warnCallCount).toBeGreaterThan(0);
  });

  it("persists incoming deposit phases before trace, risk recording, notification, and completion", async () => {
    const progressUpdates: Record<string, unknown>[] = [];
    const updateForensicCheckJobProgress = vi.fn(async (input: { progressJson: Record<string, unknown> }) => {
      progressUpdates.push(input.progressJson);
      return true;
    });
    const complete = vi.fn(async () => true);

    await runSingleIncomingDepositJobCycle({
      claimNextForensicCheckJob: async () => job(validProgressJson),
      updateForensicCheckJobProgress,
      completeForensicCheckJob: complete,
      markUserAlertSent: async () => true,
      markUserAlertFailed: async () => true,
      recordObservedTransactionRisk: async () => true,
      sendUserAlert: async () => undefined,
      formatIncomingDepositRiskAlert: () => ({
        text: "<b>Incoming USDT</b>",
        parseMode: "HTML"
      }),
      buildReport: async () => report()
    });

    expect(progressUpdates.slice(0, 4).map((progress) => progress.jobPhase)).toEqual([
      "incoming_deposit_trace",
      "risk_recording",
      "notification_delivery",
      "completing"
    ]);
    for (const progress of progressUpdates) {
      expect(progress.jobHeartbeatAt).toEqual(expect.any(String));
    }
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      status: "completed",
      progressJson: expect.objectContaining({
        jobPhase: "completing",
        jobHeartbeatAt: expect.any(String)
      })
    }));
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

  it("persists incoming deposit performance timing on completed jobs", async () => {
    let currentMs = 0;
    const progressUpdates: Record<string, unknown>[] = [];
    const complete = vi.fn(async () => true);

    await runSingleIncomingDepositJobCycle({
      claimNextForensicCheckJob: async () => job(validProgressJson),
      updateForensicCheckJobProgress: async (input) => {
        progressUpdates.push(input.progressJson);
        return true;
      },
      completeForensicCheckJob: complete,
      markUserAlertSent: async () => true,
      markUserAlertFailed: async () => true,
      recordObservedTransactionRisk: async () => true,
      sendUserAlert: async () => {
        currentMs += 5;
      },
      formatIncomingDepositRiskAlert: () => ({
        text: "<b>Incoming USDT</b>",
        parseMode: "HTML"
      }),
      buildReport: async () => {
        currentMs += 20;
        return report();
      },
      timingClock: {
        nowMs: () => currentMs
      },
      now: () => new Date("2026-05-29T14:02:05.000Z")
    });

    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      status: "completed",
      progressJson: expect.objectContaining({
        performanceTiming: expect.objectContaining({
          queueWaitMs: 1000,
          depositAgeAtStartMs: 65000,
          totalRunMs: expect.any(Number),
          stages: expect.arrayContaining([
            { name: "build_report", durationMs: 20 },
            { name: "send_alert", durationMs: 5 }
          ])
        })
      })
    }));
    expect(progressUpdates.at(-1)).toEqual(expect.objectContaining({
      performanceTiming: expect.objectContaining({
        stages: expect.arrayContaining([
          { name: "build_report", durationMs: 20 }
        ])
      })
    }));
  });

  it("logs incoming deposit job timing after completion", async () => {
    let currentMs = 0;
    const infoLogs: Array<{ event: string; fields: Record<string, unknown> | undefined }> = [];

    await runSingleIncomingDepositJobCycle({
      claimNextForensicCheckJob: async () => job(validProgressJson),
      completeForensicCheckJob: async () => true,
      markUserAlertSent: async () => true,
      markUserAlertFailed: async () => true,
      recordObservedTransactionRisk: async () => true,
      sendUserAlert: async () => {
        currentMs += 3;
      },
      formatIncomingDepositRiskAlert: () => ({
        text: "<b>Incoming USDT</b>",
        parseMode: "HTML"
      }),
      buildReport: async () => {
        currentMs += 40;
        return report();
      },
      timingClock: {
        nowMs: () => currentMs
      },
      now: () => new Date("2026-05-29T14:02:05.000Z"),
      logger: {
        info: (event, fields) => infoLogs.push({ event, fields }),
        warn: () => {},
        error: () => {}
      }
    });

    expect(infoLogs).toContainEqual({
      event: "incoming_deposit_job_timing",
      fields: expect.objectContaining({
        job_id: "job-incoming-1",
        deposit_tx_hash: depositTxHash,
        watched_wallet_id: watchedWalletId,
        sender: validProgressJson.sender,
        status: "completed",
        queue_wait_ms: 1000,
        deposit_age_at_start_ms: 65000,
        total_run_ms: expect.any(Number),
        top_stages: expect.arrayContaining([
          { name: "build_report", durationMs: 40 }
        ])
      })
    });
  });

  it("does not log timing when no incoming deposit job is claimed", async () => {
    const info = vi.fn();

    const handled = await runSingleIncomingDepositJobCycle({
      claimNextForensicCheckJob: async () => null,
      completeForensicCheckJob: async () => true,
      markUserAlertSent: async () => true,
      markUserAlertFailed: async () => true,
      recordObservedTransactionRisk: async () => true,
      sendUserAlert: async () => undefined,
      formatIncomingDepositRiskAlert: () => ({
        text: "<b>Incoming USDT</b>",
        parseMode: "HTML"
      }),
      buildReport: async () => report(),
      logger: {
        info,
        warn: () => {},
        error: () => {}
      }
    });

    expect(handled).toBe(false);
    expect(info).not.toHaveBeenCalledWith("incoming_deposit_job_timing", expect.anything());
  });

  it("persists and logs incoming deposit timing on failed jobs when report building throws", async () => {
    let currentMs = 0;
    const progressUpdates: Record<string, unknown>[] = [];
    const infoLogs: Array<{ event: string; fields: Record<string, unknown> | undefined }> = [];
    const complete = vi.fn(async () => true);

    await runSingleIncomingDepositJobCycle({
      claimNextForensicCheckJob: async () => job(validProgressJson),
      updateForensicCheckJobProgress: async (input) => {
        progressUpdates.push(input.progressJson);
        return true;
      },
      completeForensicCheckJob: complete,
      markUserAlertSent: async () => true,
      markUserAlertFailed: async () => {
        currentMs += 7;
        return true;
      },
      recordObservedTransactionRisk: async () => true,
      sendUserAlert: async () => undefined,
      formatIncomingDepositRiskAlert: () => ({
        text: "<b>Incoming USDT</b>",
        parseMode: "HTML"
      }),
      buildReport: async () => {
        currentMs += 11;
        throw new Error("risk builder unavailable");
      },
      timingClock: {
        nowMs: () => currentMs
      },
      now: () => new Date("2026-05-29T14:02:05.000Z"),
      logger: {
        info: (event, fields) => infoLogs.push({ event, fields }),
        warn: () => {},
        error: () => {}
      }
    });

    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed",
      progressJson: expect.objectContaining({
        performanceTiming: expect.objectContaining({
          queueWaitMs: 1000,
          depositAgeAtStartMs: 65000,
          stages: expect.arrayContaining([
            { name: "build_report", durationMs: 11 },
            { name: "mark_alert_failed", durationMs: 7 }
          ])
        })
      })
    }));
    expect(progressUpdates.at(-1)).toEqual(expect.objectContaining({
      performanceTiming: expect.any(Object)
    }));
    expect(infoLogs).toContainEqual({
      event: "incoming_deposit_job_timing",
      fields: expect.objectContaining({
        job_id: "job-incoming-1",
        status: "failed",
        top_stages: expect.arrayContaining([
          { name: "build_report", durationMs: 11 }
        ])
      })
    });
  });

  it("warns when incoming deposit timing progress is not applied but still completes the job", async () => {
    let updateCallCount = 0;
    const warnLogs: Array<{ event: string; fields: Record<string, unknown> | undefined }> = [];
    const complete = vi.fn(async () => true);

    await runSingleIncomingDepositJobCycle({
      claimNextForensicCheckJob: async () => job(validProgressJson),
      updateForensicCheckJobProgress: async () => {
        updateCallCount += 1;
        return updateCallCount < 5;
      },
      completeForensicCheckJob: complete,
      markUserAlertSent: async () => true,
      markUserAlertFailed: async () => true,
      recordObservedTransactionRisk: async () => true,
      sendUserAlert: async () => undefined,
      formatIncomingDepositRiskAlert: () => ({
        text: "<b>Incoming USDT</b>",
        parseMode: "HTML"
      }),
      buildReport: async () => report(),
      logger: {
        info: () => {},
        warn: (event, fields) => warnLogs.push({ event, fields }),
        error: () => {}
      }
    });

    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      status: "completed",
      progressJson: expect.objectContaining({
        performanceTiming: expect.any(Object)
      })
    }));
    expect(warnLogs).toContainEqual({
      event: "incoming_deposit_timing_persist_failed",
      fields: expect.objectContaining({
        job_id: "job-incoming-1",
        error: "progress update not applied"
      })
    });
  });
});

describe("buildIncomingDepositReport", () => {
  it("records report-level performance stages without changing the report", async () => {
    const timingStages: string[] = [];
    const timing = {
      async measure<T>(name: string, fn: () => Promise<T>): Promise<T> {
        timingStages.push(name);
        return fn();
      },
      add: () => undefined,
      summary: () => ({ queueWaitMs: null, depositAgeAtStartMs: null, totalRunMs: 0, stages: [] }),
      topStages: () => []
    };
    const createDeps = (): BuildIncomingDepositReportInput["deps"] => ({
      listIndexedUsdtTransfersForAddress: async (address: string) =>
        address === validProgressJson.sender
          ? [indexedTransfer({
              txHash: "fresh-funding",
              fromAddress: "TFunder111111111111111111111111111111",
              toAddress: address,
              amountRaw: validProgressJson.amountRaw,
              blockTimestamp: new Date("2026-05-29T13:30:00.000Z")
            })]
          : [],
      listRelatedTrc20Transfers: async () => [],
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async () => null,
      getContractIntelligenceProfile: async () => null,
      getTransaction: async () => ({}),
      getUsdtRestrictionStatus: async (address: string) => ({ ...stablecoinProfile(address), balanceRaw: "1000000" })
    });

    const baselineResult = await buildIncomingDepositReport({
      deps: createDeps(),
      job: job(validProgressJson),
      depositTxHash,
      watchedWallet: validProgressJson.watchedWallet,
      sender: validProgressJson.sender,
      amountRaw: validProgressJson.amountRaw,
      timestamp: new Date(validProgressJson.timestamp)
    });
    const timedResult = await buildIncomingDepositReport({
      deps: createDeps(),
      job: job(validProgressJson),
      depositTxHash,
      watchedWallet: validProgressJson.watchedWallet,
      sender: validProgressJson.sender,
      amountRaw: validProgressJson.amountRaw,
      timestamp: new Date(validProgressJson.timestamp),
      timing
    });

    expect(timedResult).toEqual(baselineResult);
    expect(timingStages).toEqual(expect.arrayContaining([
      "report_load_sender_labels",
      "report_evaluate_fast_sender_risk",
      "report_fetch_sender_edges",
      "report_run_where_is_money",
      "report_build_funding_bundles",
      "report_build_wallet_exposure_profile",
      "report_infer_sender_role",
      "report_assemble"
    ]));
  });

  it("composes fast sender risk, provenance, contract analysis, and final deposit risk report", async () => {
    const contract = "TFcRN111111111111111111111111FLR5hvh";
    const senderLabel: AddressLabel = {
      address: validProgressJson.sender,
      label: "scam",
      source: "service_admin",
      createdByTelegramId: "42",
      createdAt: new Date("2026-05-29T12:00:00.000Z")
    };
    const stablecoinState: StablecoinRestrictionProfile = {
      subjectAddress: validProgressJson.sender,
      tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      tokenSymbol: "USDT",
      tokenStandard: "TRC20",
      decimals: 6,
      isBlacklisted: false,
      balanceRaw: "0",
      checkedAt: "2026-05-29T14:02:00.000Z",
      evidenceStrength: "exact_contract_state",
      methods: {
        blacklist: "isBlackListed(address)",
        balance: "balanceOf(address)"
      }
    };
    const llmVerdict: ContractLlmVerdictSummary = {
      source: "llm",
      cacheMatch: null,
      reusedFromContractAddress: null,
      providerLabel: "test-llm",
      model: "test-model",
      contractAddress: contract,
      caseFileHash: "case-hash-1",
      cacheId: null,
      verdict: "drainer_like",
      confidence: 0.91,
      contractRiskScore: 93,
      decisionRecommendation: "DECLINE",
      reasons: ["Contract behavior is drainer-like."],
      citedEvidenceIds: ["contract-in-1"],
      falsePositiveNotes: []
    };

    const listIndexed = vi.fn(async (address: string) =>
      address === validProgressJson.sender
        ? [indexedTransfer({
          txHash: "contract-in-1",
          fromAddress: contract,
          toAddress: validProgressJson.sender,
          amountRaw: "384064001319"
        })]
        : []
    );
    const listLive = vi.fn(async () => []);
    const getClassification = vi.fn(async (address: string): Promise<ServiceClassification | null> =>
      address === contract
        ? { category: "unknown_contract", identity: null, confidence: "medium", evidence: ["test contract"], isBoundary: true }
        : null
    );
    const analyzeLlm = vi.fn(async () => [llmVerdict]);
    const getTransaction = vi.fn(async (txHash: string) => ({ txHash, ret: "SUCCESS" }));
    const enrichContractClassification = vi.fn(async () => ({
      address: contract,
      metadata: null,
      contractProfile: null,
      classification: { category: "unknown_contract" as const, identity: null, confidence: "medium" as const, evidence: ["test contract"], isBoundary: true },
      profileSource: "none" as const,
      liveFetchError: null
    }));

    const result = await buildIncomingDepositReport({
      deps: {
        listIndexedUsdtTransfersForAddress: listIndexed,
        listRelatedTrc20Transfers: listLive,
        getLabelsForAddress: async () => [senderLabel],
        getClassificationForAddress: getClassification,
        getContractIntelligenceProfile: async () => ({ address: contract, sourceStatus: "missing" }),
        enrichContractClassification,
        getTransaction,
        listTrc20ApprovalChanges: async () => [],
        getUsdtRestrictionStatus: async () => stablecoinState,
        analyzeContractLlmCaseFiles: analyzeLlm
      },
      job: job(validProgressJson),
      depositTxHash,
      watchedWallet: validProgressJson.watchedWallet,
      sender: validProgressJson.sender,
      amountRaw: validProgressJson.amountRaw,
      timestamp: new Date(validProgressJson.timestamp)
    });

    expect(result.decision).toBe("DECLINE");
    expect(result.fastSenderRisk).toEqual(expect.objectContaining({
      subjectAddress: validProgressJson.sender,
      level: "CRITICAL"
    }));
    expect(result.originPaths[0]).toEqual(expect.objectContaining({
      stoppedReason: "unknown_contract_reached",
      txHashes: expect.arrayContaining(["contract-in-1", depositTxHash])
    }));
    expect(result.contractVerdicts).toEqual([llmVerdict]);
    expect(result.hardBadEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "scam_or_blacklist" })
    ]));
    expect(result.warnings).toContain("Sender current balance is zero after outgoing deposit; transaction-seeded provenance was used instead of sender balance-origin mode.");
    expect(result.reasons.join(" ")).not.toMatch(/zero.*balance-origin/i);
    expect(listIndexed).toHaveBeenCalledWith(validProgressJson.sender, expect.objectContaining({
      limit: expect.any(Number),
      orderBy: "newest",
      direction: "both"
    }));
    expect(listLive).toHaveBeenCalledWith(validProgressJson.sender, expect.objectContaining({
      start: 0,
      limit: expect.any(Number)
    }));
    expect(analyzeLlm).toHaveBeenCalledTimes(1);
    expect(enrichContractClassification).toHaveBeenCalledWith(contract);
    expect(getTransaction).toHaveBeenCalledWith("contract-in-1");
  });

  it("infers clean CEX-funded sender role from injected provenance dependencies", async () => {
    const cleanCex = "TBinance1111111111111111111111111111";

    const result = await buildIncomingDepositReport({
      deps: {
        listIndexedUsdtTransfersForAddress: async (address) =>
          address === validProgressJson.sender
            ? [indexedTransfer({
              txHash: "binance-funding-1",
              fromAddress: cleanCex,
              toAddress: validProgressJson.sender,
              amountRaw: "384064001319"
            })]
            : [],
        listRelatedTrc20Transfers: async () => [],
        getLabelsForAddress: async () => [],
        getClassificationForAddress: async (address): Promise<ServiceClassification | null> =>
          address === cleanCex
            ? { category: "cex", identity: "Binance", confidence: "high", evidence: ["tag:binance"], isBoundary: true }
            : null,
        getContractIntelligenceProfile: async () => null,
        getTransaction: async () => ({}),
        getUsdtRestrictionStatus: async () => ({ ...stablecoinProfile(validProgressJson.sender), balanceRaw: "1000000" })
      },
      job: job(validProgressJson),
      depositTxHash,
      watchedWallet: validProgressJson.watchedWallet,
      sender: validProgressJson.sender,
      amountRaw: validProgressJson.amountRaw,
      timestamp: new Date(validProgressJson.timestamp)
    });

    expect(result.senderRole).toBe("clean_cex_funded_wallet");
    expect(result.fundingCoverage.cleanSourceCoverageRatio).toBeGreaterThanOrEqual(0.85);
    expect(result.reasons.join(" ")).toContain("Balance-forming paths reach allowlisted CEX sources through clean on-chain hops.");
    expect(result.reasons.join(" ")).not.toContain("Clean CEX origin is not fully proven");
    expect(result.decision).toBe("ACCEPTABLE");
  });

  it("preserves balance-aware attribution shares on incoming origin paths", async () => {
    const firstFunder = "TFirstAttributedFunder1111111111111";
    const secondFunder = "TSecondAttributedFunder111111111111";
    const amountRaw = "400000000";

    const result = await buildIncomingDepositReport({
      deps: {
        listIndexedUsdtTransfersForAddress: async (address) =>
          address === validProgressJson.sender
            ? [
                indexedTransfer({
                  txHash: "first-attributed-funding",
                  fromAddress: firstFunder,
                  toAddress: validProgressJson.sender,
                  amountRaw: "100000000",
                  blockTimestamp: new Date("2026-05-29T13:00:00.000Z")
                }),
                indexedTransfer({
                  txHash: "second-attributed-funding",
                  fromAddress: secondFunder,
                  toAddress: validProgressJson.sender,
                  amountRaw: "300000000",
                  blockTimestamp: new Date("2026-05-29T13:05:00.000Z")
                })
              ]
            : [],
        listRelatedTrc20Transfers: async () => [],
        getLabelsForAddress: async () => [],
        getClassificationForAddress: async () => null,
        getContractIntelligenceProfile: async () => null,
        getTransaction: async () => ({}),
        getUsdtRestrictionStatus: async (address) => ({ ...stablecoinProfile(address), balanceRaw: "0" })
      },
      job: job({
        ...validProgressJson,
        amountRaw,
        amount: "400"
      }),
      depositTxHash,
      watchedWallet: validProgressJson.watchedWallet,
      sender: validProgressJson.sender,
      amountRaw,
      timestamp: new Date(validProgressJson.timestamp)
    });

    const firstPath = result.originPaths.find((path) => path.txHashes.includes("first-attributed-funding"));
    const secondPath = result.originPaths.find((path) => path.txHashes.includes("second-attributed-funding"));

    expect(firstPath?.amountCoverageRatio).toBe(1);
    expect(secondPath?.amountCoverageRatio).toBe(1);
    expect(firstPath?.balanceShare).toBe(0.25);
    expect(secondPath?.balanceShare).toBe(0.75);
  });

  it("downgrades raw clean CEX sender inference when clean-source coverage is zero", async () => {
    const result = await buildIncomingDepositReport({
      deps: {
        listIndexedUsdtTransfersForAddress: async () => [],
        listRelatedTrc20Transfers: async () => [],
        getLabelsForAddress: async () => [],
        getClassificationForAddress: async (address): Promise<ServiceClassification | null> =>
          address === validProgressJson.sender
            ? { category: "cex", identity: "Binance", confidence: "high", evidence: ["tag:binance"], isBoundary: true }
            : null,
        getContractIntelligenceProfile: async () => null,
        getTransaction: async () => ({}),
        getUsdtRestrictionStatus: async () => ({ ...stablecoinProfile(validProgressJson.sender), balanceRaw: "0" })
      },
      job: job(validProgressJson),
      depositTxHash,
      watchedWallet: validProgressJson.watchedWallet,
      sender: validProgressJson.sender,
      amountRaw: validProgressJson.amountRaw,
      timestamp: new Date(validProgressJson.timestamp)
    });

    expect(result.originPaths[0]).toEqual(expect.objectContaining({
      stoppedReason: "clean_cex_reached"
    }));
    expect(result.fundingCoverage.cleanSourceCoverageRatio).toBe(0);
    expect(result.senderRole).toBe("operational_liquidity_wallet");
    expect(result.reasons.join(" ")).not.toContain("Balance-forming paths reach allowlisted CEX sources through clean on-chain hops.");
    expect(result.reasons.join(" ")).toContain("Clean CEX origin is not fully proven for the deposit amount.");
  });

  it("separates deposit funding coverage from clean-source proof for large operational deposits", async () => {
    const depositAmountRaw = "300000000000";
    const mainFundingRaw = "299000000000";
    const smallFundingRaw = "1000000000";
    const weakUpstreamRaw = "45000000000";
    const mainFunder = "TMainLiquidityFunder111111111111111";
    const smallFunder = "TSmallLiquidityFunder11111111111111";
    const upstream = "TWeakUpstreamLiquidity11111111111111";
    const depositTime = new Date(validProgressJson.timestamp).getTime();
    const mainFunding = indexedTransfer({
      txHash: "large-operational-funding-main",
      fromAddress: mainFunder,
      toAddress: validProgressJson.sender,
      amountRaw: mainFundingRaw,
      blockTimestamp: new Date(depositTime - 60_000)
    });
    const smallFunding = indexedTransfer({
      txHash: "large-operational-funding-small",
      fromAddress: smallFunder,
      toAddress: validProgressJson.sender,
      amountRaw: smallFundingRaw,
      blockTimestamp: new Date(depositTime - 120_000)
    });
    const mainOperationalIncoming = Array.from({ length: 7 }, (_, index) => indexedTransfer({
      txHash: `weak-upstream-main-funding-${index + 1}`,
      fromAddress: `${upstream}${index + 1}`,
      toAddress: mainFunder,
      amountRaw: weakUpstreamRaw,
      blockTimestamp: new Date(depositTime - (180_000 + index * 60_000))
    }));
    const mainOperationalOutgoing = Array.from({ length: 6 }, (_, index) => indexedTransfer({
      txHash: `main-operational-out-${index + 1}`,
      fromAddress: mainFunder,
      toAddress: `TMainOperationalOut${index + 1}1111111111111`,
      amountRaw: weakUpstreamRaw,
      blockTimestamp: new Date(depositTime - (240_000 + index * 60_000))
    }));
    const smallOperationalIncoming = Array.from({ length: 4 }, (_, index) => indexedTransfer({
      txHash: `small-operational-in-${index + 1}`,
      fromAddress: `TSmallOperationalIn${index + 1}1111111111111`,
      toAddress: smallFunder,
      amountRaw: smallFundingRaw,
      blockTimestamp: new Date(depositTime - (180_000 + index * 60_000))
    }));
    const smallOperationalOutgoing = Array.from({ length: 3 }, (_, index) => indexedTransfer({
      txHash: `small-operational-out-${index + 1}`,
      fromAddress: smallFunder,
      toAddress: `TSmallOperationalOut${index + 1}111111111111`,
      amountRaw: smallFundingRaw,
      blockTimestamp: new Date(depositTime - (240_000 + index * 60_000))
    }));

    const result = await buildIncomingDepositReport({
      deps: {
        listIndexedUsdtTransfersForAddress: async (address) => {
          if (address === validProgressJson.sender) return [mainFunding, smallFunding];
          if (address === mainFunder) return [mainFunding, ...mainOperationalIncoming, ...mainOperationalOutgoing];
          if (address === smallFunder) return [smallFunding, ...smallOperationalIncoming, ...smallOperationalOutgoing];
          return [];
        },
        listRelatedTrc20Transfers: async () => [],
        getLabelsForAddress: async () => [],
        getClassificationForAddress: async () => null,
        getContractIntelligenceProfile: async () => null,
        getTransaction: async () => ({}),
        getUsdtRestrictionStatus: async () => ({ ...stablecoinProfile(validProgressJson.sender), balanceRaw: "0" }),
        analyzeContractLlmCaseFiles: async () => []
      },
      job: job({ ...validProgressJson, amountRaw: depositAmountRaw }),
      depositTxHash,
      watchedWallet: validProgressJson.watchedWallet,
      sender: validProgressJson.sender,
      amountRaw: depositAmountRaw,
      timestamp: new Date(validProgressJson.timestamp)
    });

    expect(result.fundingCoverage.depositFundingCoverageRatio).toBe(1);
    expect(result.fundingCoverage.cleanSourceCoverageRatio).toBe(0);
    expect(result.fundingCoverage.exactContinuityCoverageRatio).toBe(result.originCoverage);
    expect(result.fundingCoverage.exactContinuityCoverageRatio).toBeLessThan(0.2);
    expect(result.decision).toBe("ACCEPTABLE");
  });

  it("records funding bundle context for a large intermediate transfer without changing decision", async () => {
    const depositAmountRaw = "300000000000";
    const corridorWallet = "TCorridorLiquidity111111111111111111";
    const liquidityHub = "TLargeLiquidityHub111111111111111111";
    const funderA = "TLargeBundleFunderA111111111111111";
    const funderB = "TLargeBundleFunderB111111111111111";
    const depositTime = new Date(validProgressJson.timestamp).getTime();
    const senderFunding = indexedTransfer({
      txHash: "sender-funding-from-corridor",
      fromAddress: corridorWallet,
      toAddress: validProgressJson.sender,
      amountRaw: depositAmountRaw,
      blockTimestamp: new Date(depositTime - 60_000)
    });
    const largeIntermediate = indexedTransfer({
      txHash: "large-corridor-transfer",
      fromAddress: liquidityHub,
      toAddress: corridorWallet,
      amountRaw: "600000000000",
      blockTimestamp: new Date(depositTime - 120_000)
    });
    const bundleFunding = [
      indexedTransfer({
        txHash: "bundle-funding-1",
        fromAddress: funderA,
        toAddress: liquidityHub,
        amountRaw: "200000000000",
        blockTimestamp: new Date(depositTime - 420_000)
      }),
      indexedTransfer({
        txHash: "bundle-funding-2",
        fromAddress: funderB,
        toAddress: liquidityHub,
        amountRaw: "250000000000",
        blockTimestamp: new Date(depositTime - 360_000)
      }),
      indexedTransfer({
        txHash: "bundle-funding-3",
        fromAddress: funderA,
        toAddress: liquidityHub,
        amountRaw: "140000000000",
        blockTimestamp: new Date(depositTime - 300_000)
      })
    ];
    const postFundingOperationalOutgoing = Array.from({ length: 6 }, (_, index) => indexedTransfer({
      txHash: `corridor-post-funding-out-${index + 1}`,
      fromAddress: corridorWallet,
      toAddress: `TCorridorOperationalOut${index + 1}111111`,
      amountRaw: "50000000000",
      blockTimestamp: new Date(depositTime - (50_000 - index * 5_000))
    }));
    const result = await buildIncomingDepositReport({
      deps: {
        listIndexedUsdtTransfersForAddress: async (address) => {
          if (address === validProgressJson.sender) return [senderFunding];
          if (address === corridorWallet) return [senderFunding, largeIntermediate, ...postFundingOperationalOutgoing];
          if (address === liquidityHub) return [largeIntermediate, ...bundleFunding];
          return [];
        },
        listRelatedTrc20Transfers: async () => [],
        getLabelsForAddress: async () => [],
        getClassificationForAddress: async () => null,
        getContractIntelligenceProfile: async () => null,
        getTransaction: async () => ({}),
        getUsdtRestrictionStatus: async () => ({ ...stablecoinProfile(validProgressJson.sender), balanceRaw: "0" }),
        analyzeContractLlmCaseFiles: async () => []
      },
      job: job({ ...validProgressJson, amountRaw: depositAmountRaw }),
      depositTxHash,
      watchedWallet: validProgressJson.watchedWallet,
      sender: validProgressJson.sender,
      amountRaw: depositAmountRaw,
      timestamp: new Date(validProgressJson.timestamp)
    });

    const bundles = result.originPaths.flatMap((path) => path.fundingBundles ?? []);
    expect(bundles).toEqual(expect.arrayContaining([
      expect.objectContaining({
        targetTxHash: "large-corridor-transfer",
        targetAmountRaw: "600000000000",
        bundleAmountRaw: "590000000000",
        bundleCoverageRatio: 0.9833,
        fundingTxHashes: ["bundle-funding-1", "bundle-funding-2", "bundle-funding-3"]
      })
    ]));
    expect(result.decision).toBe("ACCEPTABLE");
    expect(result.fundingCoverage.cleanSourceCoverageRatio).toBe(0);
    expect(result.reasons.join(" ")).not.toContain("Balance-forming paths reach allowlisted CEX sources through clean on-chain hops.");
  });

  it("records unproven adaptive corridor expansion without changing the deposit decision", async () => {
    const depositAmountRaw = "300000000000";
    const corridorWallet = "TAdaptiveCorridor11111111111111111";
    const liquidityHub = "TAdaptiveLiquidityHub11111111111111";
    const topFunder = "TAdaptiveTopFunder1111111111111111";
    const secondaryFunder = "TAdaptiveSecondFunder111111111111";
    const depositTime = new Date(validProgressJson.timestamp).getTime();
    const senderFunding = indexedTransfer({
      txHash: "adaptive-sender-funding",
      fromAddress: corridorWallet,
      toAddress: validProgressJson.sender,
      amountRaw: depositAmountRaw,
      blockTimestamp: new Date(depositTime - 60_000)
    });
    const largeIntermediate = indexedTransfer({
      txHash: "adaptive-large-corridor-transfer",
      fromAddress: liquidityHub,
      toAddress: corridorWallet,
      amountRaw: "600000000000",
      blockTimestamp: new Date(depositTime - 120_000)
    });
    const topBundleFunding = [
      indexedTransfer({
        txHash: "adaptive-bundle-top-funding-1",
        fromAddress: topFunder,
        toAddress: liquidityHub,
        amountRaw: "100000000000",
        blockTimestamp: new Date(depositTime - 300_000)
      }),
      indexedTransfer({
        txHash: "adaptive-bundle-top-funding-2",
        fromAddress: topFunder,
        toAddress: liquidityHub,
        amountRaw: "90000000000",
        blockTimestamp: new Date(depositTime - 290_000)
      }),
      indexedTransfer({
        txHash: "adaptive-bundle-top-funding-3",
        fromAddress: topFunder,
        toAddress: liquidityHub,
        amountRaw: "80000000000",
        blockTimestamp: new Date(depositTime - 280_000)
      }),
      indexedTransfer({
        txHash: "adaptive-bundle-top-funding-4",
        fromAddress: topFunder,
        toAddress: liquidityHub,
        amountRaw: "70000000000",
        blockTimestamp: new Date(depositTime - 270_000)
      }),
      indexedTransfer({
        txHash: "adaptive-bundle-top-funding-5",
        fromAddress: topFunder,
        toAddress: liquidityHub,
        amountRaw: "60000000000",
        blockTimestamp: new Date(depositTime - 260_000)
      })
    ];
    const secondaryBundleFunding = indexedTransfer({
      txHash: "adaptive-bundle-secondary-funding",
      fromAddress: secondaryFunder,
      toAddress: liquidityHub,
      amountRaw: "190000000000",
      blockTimestamp: new Date(depositTime - 240_000)
    });
    const postFundingOperationalOutgoing = Array.from({ length: 6 }, (_, index) => indexedTransfer({
      txHash: `adaptive-corridor-operational-out-${index + 1}`,
      fromAddress: corridorWallet,
      toAddress: `TAdaptiveOperationalOut${index + 1}111111111`,
      amountRaw: "50000000000",
      blockTimestamp: new Date(depositTime - (50_000 - index * 5_000))
    }));
    const upstreamAddresses = Array.from({ length: 20 }, (_, index) =>
      `TAdaptiveUnprovenHop${String(index + 1).padStart(2, "0")}111111`
    );
    const expansionChain = upstreamAddresses.map((fromAddress, index) => indexedTransfer({
      txHash: `adaptive-unproven-depth-${index + 1}`,
      fromAddress,
      toAddress: index === 0 ? topFunder : upstreamAddresses[index - 1],
      amountRaw: "400000000000",
      blockTimestamp: new Date(depositTime - (420_000 + index * 60_000))
    }));

    const result = await buildIncomingDepositReport({
      deps: {
        listIndexedUsdtTransfersForAddress: async (address) => {
          if (address === validProgressJson.sender) return [senderFunding];
          if (address === corridorWallet) return [senderFunding, largeIntermediate, ...postFundingOperationalOutgoing];
          if (address === liquidityHub) return [largeIntermediate, ...topBundleFunding, secondaryBundleFunding];
          if (address === topFunder) return [...topBundleFunding, expansionChain[0]];
          const upstreamIndex = upstreamAddresses.indexOf(address);
          if (upstreamIndex >= 0) {
            return [
              expansionChain[upstreamIndex],
              ...(expansionChain[upstreamIndex + 1] ? [expansionChain[upstreamIndex + 1]] : [])
            ];
          }
          if (address === secondaryFunder) return [secondaryBundleFunding];
          return [];
        },
        listRelatedTrc20Transfers: async () => [],
        getLabelsForAddress: async () => [],
        getClassificationForAddress: async () => null,
        getContractIntelligenceProfile: async () => null,
        getTransaction: async () => ({}),
        getUsdtRestrictionStatus: async () => ({ ...stablecoinProfile(validProgressJson.sender), balanceRaw: "0" }),
        analyzeContractLlmCaseFiles: async () => []
      },
      job: job({ ...validProgressJson, amountRaw: depositAmountRaw }),
      depositTxHash,
      watchedWallet: validProgressJson.watchedWallet,
      sender: validProgressJson.sender,
      amountRaw: depositAmountRaw,
      timestamp: new Date(validProgressJson.timestamp)
    });

    const bundle = result.originPaths
      .flatMap((path) => path.fundingBundles ?? [])
      .find((item) => item.targetTxHash === "adaptive-large-corridor-transfer");
    expect(bundle?.deepExpansion).toEqual(expect.objectContaining({
      status: "unproven_corridor",
      maxDepth: 20,
      topExpandedFunders: [topFunder, secondaryFunder]
    }));
    expect(bundle?.deepExpansion?.fetchedAddressCount).toBeGreaterThanOrEqual(20);
    expect(bundle?.deepExpansion?.reasons).toContain("traced_edges:2");
    expect(result.decision).toBe("ACCEPTABLE");
    expect(result.fundingCoverage.cleanSourceCoverageRatio).toBe(0);
    expect(result.reasons.join(" ")).not.toContain("Balance-forming paths reach allowlisted CEX sources through clean on-chain hops.");
  });

  it("records clean source reached by adaptive funding-bundle expansion", async () => {
    const depositAmountRaw = "300000000000";
    const corridorWallet = "TAdaptiveCleanCorridor111111111111";
    const liquidityHub = "TAdaptiveCleanLiquidity11111111111";
    const topFunder = "TAdaptiveCleanTopFunder1111111111";
    const secondaryFunder = "TAdaptiveCleanSecondFunder111111";
    const cleanCex = "TAdaptiveCleanBinance11111111111111";
    const depositTime = new Date(validProgressJson.timestamp).getTime();
    const senderFunding = indexedTransfer({
      txHash: "adaptive-clean-sender-funding",
      fromAddress: corridorWallet,
      toAddress: validProgressJson.sender,
      amountRaw: depositAmountRaw,
      blockTimestamp: new Date(depositTime - 60_000)
    });
    const largeIntermediate = indexedTransfer({
      txHash: "adaptive-clean-large-corridor-transfer",
      fromAddress: liquidityHub,
      toAddress: corridorWallet,
      amountRaw: "600000000000",
      blockTimestamp: new Date(depositTime - 120_000)
    });
    const topBundleFunding = indexedTransfer({
      txHash: "adaptive-clean-bundle-top-funding",
      fromAddress: topFunder,
      toAddress: liquidityHub,
      amountRaw: "400000000000",
      blockTimestamp: new Date(depositTime - 300_000)
    });
    const secondaryBundleFunding = indexedTransfer({
      txHash: "adaptive-clean-bundle-secondary-funding",
      fromAddress: secondaryFunder,
      toAddress: liquidityHub,
      amountRaw: "190000000000",
      blockTimestamp: new Date(depositTime - 240_000)
    });
    const cexFunding = indexedTransfer({
      txHash: "adaptive-clean-cex-funding",
      fromAddress: cleanCex,
      toAddress: topFunder,
      amountRaw: "400000000000",
      blockTimestamp: new Date(depositTime - 420_000)
    });

    const result = await buildIncomingDepositReport({
      deps: {
        listIndexedUsdtTransfersForAddress: async (address) => {
          if (address === validProgressJson.sender) return [senderFunding];
          if (address === corridorWallet) return [senderFunding, largeIntermediate];
          if (address === liquidityHub) return [largeIntermediate, topBundleFunding, secondaryBundleFunding];
          if (address === topFunder) return [topBundleFunding, cexFunding];
          if (address === secondaryFunder) return [secondaryBundleFunding];
          return [];
        },
        listRelatedTrc20Transfers: async () => [],
        getLabelsForAddress: async () => [],
        getClassificationForAddress: async (address): Promise<ServiceClassification | null> =>
          address === cleanCex
            ? { category: "cex", identity: "Binance", confidence: "high", evidence: ["tag:binance"], isBoundary: true }
            : null,
        getContractIntelligenceProfile: async () => null,
        getTransaction: async () => ({}),
        getUsdtRestrictionStatus: async () => ({ ...stablecoinProfile(validProgressJson.sender), balanceRaw: "0" }),
        analyzeContractLlmCaseFiles: async () => []
      },
      job: job({ ...validProgressJson, amountRaw: depositAmountRaw }),
      depositTxHash,
      watchedWallet: validProgressJson.watchedWallet,
      sender: validProgressJson.sender,
      amountRaw: depositAmountRaw,
      timestamp: new Date(validProgressJson.timestamp)
    });

    const bundle = result.originPaths
      .flatMap((path) => path.fundingBundles ?? [])
      .find((item) => item.targetTxHash === "adaptive-clean-large-corridor-transfer");
    expect(bundle?.deepExpansion).toEqual(expect.objectContaining({
      status: "clean_source_reached",
      maxDepth: 20,
      topExpandedFunders: [topFunder, secondaryFunder]
    }));
    expect(result.decision).toBe("ACCEPTABLE");
    expect(result.fundingCoverage.depositFundingCoverageRatio).toBe(1);
  });

  it("weights minority clean-source proof by funding share instead of amount preservation", async () => {
    const depositAmountRaw = "300000000000";
    const operationalFundingRaw = "299000000000";
    const cleanFundingRaw = "1000000000";
    const weakUpstreamRaw = "45000000000";
    const operationalFunder = "TOperationalLiquidityFunder11111111";
    const cleanCex = "TBinanceMinorityClean111111111111111";
    const upstream = "TMinorityWeakUpstream1111111111111";
    const depositTime = new Date(validProgressJson.timestamp).getTime();
    const operationalFunding = indexedTransfer({
      txHash: "minority-clean-operational-funding",
      fromAddress: operationalFunder,
      toAddress: validProgressJson.sender,
      amountRaw: operationalFundingRaw,
      blockTimestamp: new Date(depositTime - 120_000)
    });
    const cleanFunding = indexedTransfer({
      txHash: "minority-clean-cex-funding",
      fromAddress: cleanCex,
      toAddress: validProgressJson.sender,
      amountRaw: cleanFundingRaw,
      blockTimestamp: new Date(depositTime - 60_000)
    });
    const operationalIncoming = Array.from({ length: 7 }, (_, index) => indexedTransfer({
      txHash: `minority-clean-operational-in-${index + 1}`,
      fromAddress: `${upstream}${index + 1}`,
      toAddress: operationalFunder,
      amountRaw: weakUpstreamRaw,
      blockTimestamp: new Date(depositTime - (180_000 + index * 60_000))
    }));
    const operationalOutgoing = Array.from({ length: 6 }, (_, index) => indexedTransfer({
      txHash: `minority-clean-operational-out-${index + 1}`,
      fromAddress: operationalFunder,
      toAddress: `TMinorityOperationalOut${index + 1}1111111`,
      amountRaw: weakUpstreamRaw,
      blockTimestamp: new Date(depositTime - (240_000 + index * 60_000))
    }));

    const result = await buildIncomingDepositReport({
      deps: {
        listIndexedUsdtTransfersForAddress: async (address) => {
          if (address === validProgressJson.sender) return [cleanFunding, operationalFunding];
          if (address === operationalFunder) return [operationalFunding, ...operationalIncoming, ...operationalOutgoing];
          return [];
        },
        listRelatedTrc20Transfers: async () => [],
        getLabelsForAddress: async () => [],
        getClassificationForAddress: async (address): Promise<ServiceClassification | null> =>
          address === cleanCex
            ? { category: "cex", identity: "Binance", confidence: "high", evidence: ["tag:binance"], isBoundary: true }
            : null,
        getContractIntelligenceProfile: async () => null,
        getTransaction: async () => ({}),
        getUsdtRestrictionStatus: async () => ({ ...stablecoinProfile(validProgressJson.sender), balanceRaw: "0" }),
        analyzeContractLlmCaseFiles: async () => []
      },
      job: job({ ...validProgressJson, amountRaw: depositAmountRaw }),
      depositTxHash,
      watchedWallet: validProgressJson.watchedWallet,
      sender: validProgressJson.sender,
      amountRaw: depositAmountRaw,
      timestamp: new Date(validProgressJson.timestamp)
    });

    expect(result.fundingCoverage.depositFundingCoverageRatio).toBe(1);
    expect(result.fundingCoverage.cleanSourceCoverageRatio).toBe(0.0033);
    expect(result.fundingCoverage.cleanSourceCoverageRatio).toBeLessThan(0.85);
    expect(result.fundingCoverage.exactContinuityCoverageRatio).toBe(result.originCoverage);
    expect(result.senderRole).toBe("partial_cex_context_wallet");
    expect(result.reasons.join(" ")).not.toContain("Balance-forming paths reach allowlisted CEX sources through clean on-chain hops.");
    expect(result.reasons.join(" ")).toContain("Clean CEX origin is not fully proven");
  });

  it("extends unresolved fast provenance and reaches clean CEX", async () => {
    const chain = provenanceChain(5, "TBinanceDepthFive1111111111111111111");

    const result = await buildIncomingDepositReport({
      deps: {
        listIndexedUsdtTransfersForAddress: async (address) => chain.transfersByRecipient.get(address) ?? [],
        listRelatedTrc20Transfers: async () => [],
        getLabelsForAddress: async () => [],
        getClassificationForAddress: async (address): Promise<ServiceClassification | null> =>
          address === chain.origin
            ? { category: "cex", identity: "Binance", confidence: "high", evidence: ["tag:binance"], isBoundary: true }
            : null,
        getContractIntelligenceProfile: async () => null,
        getTransaction: async () => ({}),
        getUsdtRestrictionStatus: async () => ({ ...stablecoinProfile(validProgressJson.sender), balanceRaw: "1000000" })
      },
      job: job(validProgressJson),
      depositTxHash,
      watchedWallet: validProgressJson.watchedWallet,
      sender: validProgressJson.sender,
      amountRaw: validProgressJson.amountRaw,
      timestamp: new Date(validProgressJson.timestamp)
    });

    expect(result.originPaths[0]).toEqual(expect.objectContaining({
      stoppedReason: "clean_cex_reached",
      proximityHops: 5
    }));
    expect(result.warnings.join(" ")).toContain("Transaction check: balance-forming transfer was supplied from the checked transaction.");
  });

  it("extends mixed medium-policy and unresolved fast provenance", async () => {
    const whitebit = "TWhitebitMixed111111111111111111111";
    const origin = "TBinanceMixedDepthFive1111111111111";
    const hops = [
      "TMixedHop011111111111111111111111111",
      "TMixedHop021111111111111111111111111",
      "TMixedHop031111111111111111111111111",
      "TMixedHop041111111111111111111111111"
    ];
    const whitebitRaw = "192032000659";
    const branchRaw = "192032000660";
    const depositTime = new Date(validProgressJson.timestamp).getTime();
    const transfersByRecipient = new Map<string, IndexedTronUsdtTransfer[]>([
      [validProgressJson.sender, [
        indexedTransfer({
          txHash: "whitebit-mixed-funding",
          fromAddress: whitebit,
          toAddress: validProgressJson.sender,
          amountRaw: whitebitRaw,
          blockTimestamp: new Date(depositTime - 60_000)
        }),
        indexedTransfer({
          txHash: "mixed-depth-1",
          fromAddress: hops[0],
          toAddress: validProgressJson.sender,
          amountRaw: branchRaw,
          blockTimestamp: new Date(depositTime - 120_000)
        })
      ]],
      [hops[0], [indexedTransfer({ txHash: "mixed-depth-2", fromAddress: hops[1], toAddress: hops[0], amountRaw: branchRaw, blockTimestamp: new Date(depositTime - 180_000) })]],
      [hops[1], [indexedTransfer({ txHash: "mixed-depth-3", fromAddress: hops[2], toAddress: hops[1], amountRaw: branchRaw, blockTimestamp: new Date(depositTime - 240_000) })]],
      [hops[2], [indexedTransfer({ txHash: "mixed-depth-4", fromAddress: hops[3], toAddress: hops[2], amountRaw: branchRaw, blockTimestamp: new Date(depositTime - 300_000) })]],
      [hops[3], [indexedTransfer({ txHash: "mixed-depth-5", fromAddress: origin, toAddress: hops[3], amountRaw: branchRaw, blockTimestamp: new Date(depositTime - 360_000) })]]
    ]);

    const result = await buildIncomingDepositReport({
      deps: {
        listIndexedUsdtTransfersForAddress: async (address) => transfersByRecipient.get(address) ?? [],
        listRelatedTrc20Transfers: async () => [],
        getLabelsForAddress: async () => [],
        getClassificationForAddress: async (address): Promise<ServiceClassification | null> => {
          if (address === whitebit) {
            return { category: "cex", identity: "WhiteBIT", confidence: "high", evidence: ["tag:whitebit"], isBoundary: true };
          }
          if (address === origin) {
            return { category: "cex", identity: "Binance", confidence: "high", evidence: ["tag:binance"], isBoundary: true };
          }
          return null;
        },
        getContractIntelligenceProfile: async () => null,
        getTransaction: async () => ({}),
        getUsdtRestrictionStatus: async () => ({ ...stablecoinProfile(validProgressJson.sender), balanceRaw: "1000000" })
      },
      job: job(validProgressJson),
      depositTxHash,
      watchedWallet: validProgressJson.watchedWallet,
      sender: validProgressJson.sender,
      amountRaw: validProgressJson.amountRaw,
      timestamp: new Date(validProgressJson.timestamp)
    });

    expect(result.originPaths).toEqual(expect.arrayContaining([
      expect.objectContaining({ stoppedReason: "whitebit_reached" }),
      expect.objectContaining({ stoppedReason: "clean_cex_reached", proximityHops: 5 })
    ]));
    expect(result.warnings.join(" ")).toContain("Transaction check: balance-forming transfer was supplied from the checked transaction.");
  });

  it("keeps minority contextual source-policy paths acceptable when shared provenance is acceptable", async () => {
    const whitebit = "TWhitebitMinority11111111111111111";
    const cleanCex = "TBinanceMajority1111111111111111111";
    const whitebitRaw = "38406400131";
    const cleanRaw = "345657601188";
    const depositTime = new Date(validProgressJson.timestamp).getTime();

    const result = await buildIncomingDepositReport({
      deps: {
        listIndexedUsdtTransfersForAddress: async (address) =>
          address === validProgressJson.sender
            ? [
              indexedTransfer({
                txHash: "minority-whitebit-funding-1",
                fromAddress: whitebit,
                toAddress: validProgressJson.sender,
                amountRaw: whitebitRaw,
                blockTimestamp: new Date(depositTime - 60_000)
              }),
              indexedTransfer({
                txHash: "majority-binance-funding-1",
                fromAddress: cleanCex,
                toAddress: validProgressJson.sender,
                amountRaw: cleanRaw,
                blockTimestamp: new Date(depositTime - 120_000)
              })
            ]
            : [],
        listRelatedTrc20Transfers: async () => [],
        getLabelsForAddress: async () => [],
        getClassificationForAddress: async (address): Promise<ServiceClassification | null> => {
          if (address === whitebit) {
            return { category: "cex", identity: "WhiteBIT", confidence: "high", evidence: ["tag:whitebit"], isBoundary: true };
          }
          if (address === cleanCex) {
            return { category: "cex", identity: "Binance", confidence: "high", evidence: ["tag:binance"], isBoundary: true };
          }
          return null;
        },
        getContractIntelligenceProfile: async () => null,
        getTransaction: async () => ({}),
        getUsdtRestrictionStatus: async () => ({ ...stablecoinProfile(validProgressJson.sender), balanceRaw: "1000000" })
      },
      job: job(validProgressJson),
      depositTxHash,
      watchedWallet: validProgressJson.watchedWallet,
      sender: validProgressJson.sender,
      amountRaw: validProgressJson.amountRaw,
      timestamp: new Date(validProgressJson.timestamp)
    });

    expect(result.decision).toBe("ACCEPTABLE");
    expect(result.depositRiskScore).toBeLessThan(60);
    expect(result.hardBadEvidence).toEqual([]);
    expect(result.originPaths[0]).toEqual(expect.objectContaining({
      stoppedReason: "whitebit_reached",
      verdict: "ACCEPTABLE",
      sourcePolicy: "medium_policy"
    }));
    expect(result.originPaths[0]?.verdict).not.toBe("DECLINE");
    expect(result.originPaths[0]?.sourcePolicy).not.toBe("hard_decline");
  });

  it("does not extend when hard decline provenance is found in the fast pass", async () => {
    const htx = "THTXFastBoundary111111111111111111111";

    const result = await buildIncomingDepositReport({
      deps: {
        listIndexedUsdtTransfersForAddress: async (address) =>
          address === validProgressJson.sender
            ? [indexedTransfer({
              txHash: "htx-fast-funding-1",
              fromAddress: htx,
              toAddress: validProgressJson.sender,
              amountRaw: validProgressJson.amountRaw
            })]
            : [],
        listRelatedTrc20Transfers: async () => [],
        getLabelsForAddress: async () => [],
        getClassificationForAddress: async (address): Promise<ServiceClassification | null> =>
          address === htx
            ? { category: "cex", identity: "HTX", confidence: "high", evidence: ["tag:htx"], isBoundary: true }
            : null,
        getContractIntelligenceProfile: async () => null,
        getTransaction: async () => ({}),
        getUsdtRestrictionStatus: async () => ({ ...stablecoinProfile(validProgressJson.sender), balanceRaw: "1000000" })
      },
      job: job(validProgressJson),
      depositTxHash,
      watchedWallet: validProgressJson.watchedWallet,
      sender: validProgressJson.sender,
      amountRaw: validProgressJson.amountRaw,
      timestamp: new Date(validProgressJson.timestamp)
    });

    expect(result.decision).toBe("DECLINE");
    expect(result.originPaths[0]).toEqual(expect.objectContaining({
      stoppedReason: "htx_huobi_reached",
      verdict: "DECLINE",
      sourcePolicy: "hard_decline"
    }));
    expect(result.warnings).not.toContain("Incoming deposit provenance search was extended beyond the fast depth budget.");
  });

  it("attaches fresh bundle and wallet exposure profiles for HTX-funded incoming deposits", async () => {
    const htx = "THTXExposureProfile111111111111111111";

    const result = await buildIncomingDepositReport({
      deps: {
        listIndexedUsdtTransfersForAddress: async (address) =>
          address === validProgressJson.sender
            ? [indexedTransfer({
              txHash: "htx-profile-funding-1",
              fromAddress: htx,
              toAddress: validProgressJson.sender,
              amountRaw: validProgressJson.amountRaw
            })]
            : [],
        listRelatedTrc20Transfers: async () => [],
        getLabelsForAddress: async () => [],
        getClassificationForAddress: async (address): Promise<ServiceClassification | null> =>
          address === htx
            ? { category: "cex", identity: "HTX", confidence: "high", evidence: ["tag:htx"], isBoundary: true }
            : null,
        getContractIntelligenceProfile: async () => null,
        getTransaction: async () => ({}),
        getUsdtRestrictionStatus: async () => ({ ...stablecoinProfile(validProgressJson.sender), balanceRaw: "1000000" })
      },
      job: job(validProgressJson),
      depositTxHash,
      watchedWallet: validProgressJson.watchedWallet,
      sender: validProgressJson.sender,
      amountRaw: validProgressJson.amountRaw,
      timestamp: new Date(validProgressJson.timestamp)
    });

    expect(result.originPaths[0]).toEqual(expect.objectContaining({
      stoppedReason: "htx_huobi_reached",
      sourcePolicy: "hard_decline"
    }));
    expect(result.freshBundleExposure).toEqual(expect.objectContaining({
      targetAmountRaw: validProgressJson.amountRaw,
      htxHuobiShare: 1,
      dominantFreshSource: "htx_huobi"
    }));
    expect(result.sourceBundleExposure).toEqual(expect.objectContaining({
      scope: "incoming_deposit",
      targetAmountRaw: validProgressJson.amountRaw,
      coveredAmountRaw: validProgressJson.amountRaw,
      coverageRatio: 1,
      htxHuobiShare: result.freshBundleExposure?.htxHuobiShare,
      cleanCexShare: result.freshBundleExposure?.cleanCexShare,
      dominantSource: "htx_huobi"
    }));
    expect(result.freshBundleExposure?.reasons.join(" ")).toContain("HTX/Huobi");
    expect(result.walletExposureProfile).toEqual(expect.objectContaining({
      windowStart: "2026-05-29T13:00:00.000Z",
      windowEnd: validProgressJson.timestamp,
      transferEventsScanned: 2,
      incomingVolumeRaw: validProgressJson.amountRaw,
      outgoingVolumeRaw: validProgressJson.amountRaw,
      htxHuobiIncomingShare: 1
    }));
    expect(result.walletExposureProfile?.scoreContribution).toBeGreaterThan(0);
    expect(result.walletExposureProfile?.reasons.join(" ")).toContain("Historical HTX/Huobi sender inflow");
    expect(result.subjectExposureProfile).toEqual(expect.objectContaining({
      subjectAddress: validProgressJson.sender,
      scoreContribution: result.walletExposureProfile?.scoreContribution,
      htxHuobiIncomingShare: result.walletExposureProfile?.htxHuobiIncomingShare
    }));
  });

  it("explains historical HTX/Huobi exposure without claiming deposit-source proof", async () => {
    const htx = "THTXHistoricalContext11111111111111";
    const cleanCex = "TBinanceFreshClean111111111111111";
    const depositTime = new Date(validProgressJson.timestamp).getTime();
    const reportJob = {
      ...job(validProgressJson),
      windowStart: new Date(depositTime - 22 * 24 * 60 * 60 * 1000)
    };

    const result = await buildIncomingDepositReport({
      deps: {
        listIndexedUsdtTransfersForAddress: async (address) =>
          address === validProgressJson.sender
            ? [
                indexedTransfer({
                  txHash: "old-htx-context",
                  fromAddress: htx,
                  toAddress: validProgressJson.sender,
                  amountRaw: "400000000000",
                  blockTimestamp: new Date(depositTime - 21 * 24 * 60 * 60 * 1000)
                }),
                indexedTransfer({
                  txHash: "fresh-clean",
                  fromAddress: cleanCex,
                  toAddress: validProgressJson.sender,
                  amountRaw: validProgressJson.amountRaw,
                  blockTimestamp: new Date(depositTime - 10 * 60_000)
                })
              ]
            : [],
        listRelatedTrc20Transfers: async () => [],
        getLabelsForAddress: async () => [],
        getClassificationForAddress: async (address): Promise<ServiceClassification | null> => {
          if (address === htx) {
            return { category: "cex", identity: "HTX 4", confidence: "high", evidence: ["metadata:HTX"], isBoundary: true };
          }
          if (address === cleanCex) {
            return { category: "cex", identity: "Binance", confidence: "high", evidence: ["metadata:Binance"], isBoundary: true };
          }
          return null;
        },
        getContractIntelligenceProfile: async () => null,
        getTransaction: async () => ({}),
        getUsdtRestrictionStatus: async () => ({ ...stablecoinProfile(validProgressJson.sender), balanceRaw: "0" })
      },
      job: reportJob,
      depositTxHash,
      watchedWallet: validProgressJson.watchedWallet,
      sender: validProgressJson.sender,
      amountRaw: validProgressJson.amountRaw,
      timestamp: new Date(validProgressJson.timestamp)
    });

    const text = result.reasons.join(" ");
    expect(result.freshBundleExposure).toEqual(expect.objectContaining({
      htxHuobiShare: 0,
      cleanCexShare: 1,
      dominantFreshSource: "clean_cex"
    }));
    expect(result.sourceBundleExposure).toEqual(expect.objectContaining({
      scope: "incoming_deposit",
      targetAmountRaw: validProgressJson.amountRaw,
      htxHuobiShare: 0,
      cleanCexShare: 1,
      dominantSource: "clean_cex"
    }));
    expect(result.subjectExposureProfile).toEqual(expect.objectContaining({
      subjectAddress: validProgressJson.sender
    }));
    expect(result.sourceBundleExposure?.htxHuobiShare).toBe(0);
    expect(result.subjectExposureProfile?.htxHuobiIncomingShare).toBeGreaterThan(0);
    expect(result.walletExposureProfile?.reasons.join(" ")).toContain("Historical HTX/Huobi");
    expect(text).toContain("Historical HTX/Huobi");
    expect(text).not.toContain("100% of selected provenance target");
  });

  it("keeps non-clean fresh exposure reasons when clean CEX is the dominant fresh source", async () => {
    const htx = "THTXMixedFresh111111111111111111111";
    const cleanCex = "TBinanceMixedFresh111111111111111";
    const amountRaw = "100000000000";
    const depositTime = new Date(validProgressJson.timestamp).getTime();

    const result = await buildIncomingDepositReport({
      deps: {
        listIndexedUsdtTransfersForAddress: async (address) =>
          address === validProgressJson.sender
            ? [
                indexedTransfer({
                  txHash: "mixed-fresh-clean",
                  fromAddress: cleanCex,
                  toAddress: validProgressJson.sender,
                  amountRaw: "51000000000",
                  blockTimestamp: new Date(depositTime - 10 * 60_000)
                }),
                indexedTransfer({
                  txHash: "mixed-fresh-htx",
                  fromAddress: htx,
                  toAddress: validProgressJson.sender,
                  amountRaw: "49000000000",
                  blockTimestamp: new Date(depositTime - 20 * 60_000)
                })
              ]
            : [],
        listRelatedTrc20Transfers: async () => [],
        getLabelsForAddress: async () => [],
        getClassificationForAddress: async (address): Promise<ServiceClassification | null> => {
          if (address === htx) {
            return { category: "cex", identity: "HTX 4", confidence: "high", evidence: ["metadata:HTX"], isBoundary: true };
          }
          if (address === cleanCex) {
            return { category: "cex", identity: "Binance", confidence: "high", evidence: ["metadata:Binance"], isBoundary: true };
          }
          return null;
        },
        getContractIntelligenceProfile: async () => null,
        getTransaction: async () => ({}),
        getUsdtRestrictionStatus: async () => ({ ...stablecoinProfile(validProgressJson.sender), balanceRaw: "0" })
      },
      job: job({ ...validProgressJson, amountRaw, amount: "100000" }),
      depositTxHash,
      watchedWallet: validProgressJson.watchedWallet,
      sender: validProgressJson.sender,
      amountRaw,
      timestamp: new Date(validProgressJson.timestamp)
    });

    const text = result.reasons.join(" ");
    expect(result.freshBundleExposure).toEqual(expect.objectContaining({
      htxHuobiShare: 0.49,
      cleanCexShare: 0.51,
      dominantFreshSource: "clean_cex"
    }));
    expect(result.sourceBundleExposure).toEqual(expect.objectContaining({
      scope: "incoming_deposit",
      targetAmountRaw: amountRaw,
      htxHuobiShare: result.freshBundleExposure?.htxHuobiShare,
      cleanCexShare: result.freshBundleExposure?.cleanCexShare,
      dominantSource: "clean_cex"
    }));
    expect(result.sourceBundleExposure?.coveredAmountRaw).toBe(amountRaw);
    expect(result.sourceBundleExposure?.coverageRatio).toBeGreaterThan(0.99);
    expect(result.sourceBundleExposure?.htxHuobiShare).toBe(0.49);
    expect(result.sourceBundleExposure?.cleanCexShare).toBe(0.51);
    expect(result.freshBundleExposure?.reasons.join(" ")).toContain("HTX/Huobi accounts for 49% of checked-deposit source share.");
    expect(result.freshBundleExposure?.reasons.join(" ")).toContain("Clean CEX accounts for 51% of checked-deposit source share.");
    expect(text).toContain("HTX/Huobi accounts for 49% of checked-deposit source share.");
    expect(text).not.toContain("Clean CEX accounts for 51% of checked-deposit source share.");
  });

  it("uses depth 20 for large deposits", async () => {
    const chain = provenanceChain(20, "TBinanceDepthTwenty1111111111111111");

    const result = await buildIncomingDepositReport({
      deps: {
        listIndexedUsdtTransfersForAddress: async (address) => chain.transfersByRecipient.get(address) ?? [],
        listRelatedTrc20Transfers: async () => [],
        getLabelsForAddress: async () => [],
        getClassificationForAddress: async (address): Promise<ServiceClassification | null> =>
          address === chain.origin
            ? { category: "cex", identity: "Binance", confidence: "high", evidence: ["tag:binance"], isBoundary: true }
            : null,
        getContractIntelligenceProfile: async () => null,
        getTransaction: async () => ({}),
        getUsdtRestrictionStatus: async () => ({ ...stablecoinProfile(validProgressJson.sender), balanceRaw: "1000000" })
      },
      job: job({ ...validProgressJson, amountRaw: "100000000000" }),
      depositTxHash,
      watchedWallet: validProgressJson.watchedWallet,
      sender: validProgressJson.sender,
      amountRaw: "100000000000",
      timestamp: new Date(validProgressJson.timestamp)
    });

    expect(result.originPaths[0]).toEqual(expect.objectContaining({
      stoppedReason: "clean_cex_reached",
      proximityHops: 20
    }));
    expect(result.corridorSummary).toBeNull();
    expect(result.warnings.join(" ")).toContain("Transaction check: balance-forming transfer was supplied from the checked transaction.");
  });

  it("compresses long unresolved operational chains into liquidity corridor context", async () => {
    const chain = provenanceChain(8, "TUnresolvedLiquidityOrigin1111111111");

    const result = await buildIncomingDepositReport({
      deps: {
        listIndexedUsdtTransfersForAddress: async (address) => chain.transfersByRecipient.get(address) ?? [],
        listRelatedTrc20Transfers: async () => [],
        getLabelsForAddress: async () => [],
        getClassificationForAddress: async () => null,
        getContractIntelligenceProfile: async () => null,
        getTransaction: async () => ({}),
        getUsdtRestrictionStatus: async () => ({ ...stablecoinProfile(validProgressJson.sender), balanceRaw: "1000000" })
      },
      job: job(validProgressJson),
      depositTxHash,
      watchedWallet: validProgressJson.watchedWallet,
      sender: validProgressJson.sender,
      amountRaw: validProgressJson.amountRaw,
      timestamp: new Date(validProgressJson.timestamp)
    });

    expect(result.originPaths[0]).toEqual(expect.objectContaining({
      sourcePolicy: "unknown",
      stoppedReason: "no_previous_transfer"
    }));
    expect(result.corridorSummary).toEqual(expect.objectContaining({
      kind: "large_liquidity_corridor",
      cleanSourceReached: false,
      hardRiskReached: false,
      largestTransferRaw: validProgressJson.amountRaw
    }));
    expect(result.corridorSummary?.pathLength).toBeGreaterThanOrEqual(8);
    expect(result.fundingCoverage.cleanSourceCoverageRatio).toBe(0);
    expect(result.senderRole).not.toBe("clean_cex_funded_wallet");
  });

  it("passes Stage 2 deps for a large transaction-seeded bridge deposit", async () => {
    const provider = countingDiscoveryProvider({
      transfers: [incomingStage2Transfer()]
    });

    const result = await buildIncomingDepositReport({
      deps: stage2IncomingDeps({
        crossChainDiscoveryProvider: provider,
        evmEvidenceProvider: emptyEvmEvidenceProvider(),
        crossChainStage2Enabled: true,
        crossChainMaxProviderCalls: 1
      }),
      job: job({ ...validProgressJson, sender: stage2BridgeSender, amountRaw: "100000000000" }),
      depositTxHash,
      watchedWallet: validProgressJson.watchedWallet,
      sender: stage2BridgeSender,
      amountRaw: "100000000000",
      timestamp: new Date(validProgressJson.timestamp)
    });

    expect(provider.calls).toEqual([`tx:${depositTxHash}`]);
    expect(result.warnings.join(" ")).toContain("Cross-chain provider budget exhausted");
  });

  it("surfaces Stage 2 partial notes in incoming report warnings", async () => {
    const result = await buildIncomingDepositReport({
      deps: stage2IncomingDeps({
        crossChainStage2Enabled: true,
        crossChainMaxProviderCalls: 20
      }),
      job: job({ ...validProgressJson, sender: stage2BridgeSender, amountRaw: "100000000000" }),
      depositTxHash,
      watchedWallet: validProgressJson.watchedWallet,
      sender: stage2BridgeSender,
      amountRaw: "100000000000",
      timestamp: new Date(validProgressJson.timestamp)
    });

    expect(result.warnings).toContain("Stage 2 was triggered, but the cross-chain discovery provider is unavailable.");
  });

  it("keeps no-name liquidity as source-policy risk effect rather than incoming hard bad evidence", async () => {
    const result = await buildIncomingDepositReport({
      deps: stage2IncomingDeps({
        crossChainDiscoveryProvider: countingDiscoveryProvider({
          transfers: [incomingStage2Transfer({
            destination: { chain: "ethereum", chainId: 1, address: stage2GaryActor },
            destinationTxHash: "0xgary"
          })]
        }),
        evmEvidenceProvider: noNameLiquidityEvmProvider(),
        crossChainStage2Enabled: true,
        crossChainMaxProviderCalls: 30
      }),
      job: job({ ...validProgressJson, sender: stage2BridgeSender, amountRaw: "100000000000" }),
      depositTxHash,
      watchedWallet: validProgressJson.watchedWallet,
      sender: stage2BridgeSender,
      amountRaw: "100000000000",
      timestamp: new Date(validProgressJson.timestamp)
    });

    expect(result.decision).toBe("DECLINE");
    expect(result.depositRiskScore).toBeGreaterThanOrEqual(75);
    expect(result.riskBand).toBe("HIGH");
    expect(result.unifiedRiskSummary?.policyFloor).toBeGreaterThanOrEqual(70);
    expect(result.unifiedRiskSummary?.finalScore).toBe(result.depositRiskScore);
    expect(result.unifiedRiskSummary?.finalDecision).toBe(result.decision);
    expect(result.unifiedRiskSummary?.activeAnchor?.source).toBe("policy_floor");
    expect(result.reasons.join(" ")).toContain("no-name token liquidity");
    expect(result.hardBadEvidence).toEqual([]);
  });

  it("preserves exact sanctioned Stage 2 evidence as incoming hard proof", async () => {
    const result = await buildIncomingDepositReport({
      deps: stage2IncomingDeps({
        crossChainDiscoveryProvider: countingDiscoveryProvider({
          transfers: [incomingStage2Transfer({
            destination: { chain: "ethereum", chainId: 1, address: stage2SanctionedActor }
          })],
          riskSnapshots: [incomingStage2RiskSnapshot()]
        }),
        evmEvidenceProvider: emptyEvmEvidenceProvider(),
        crossChainStage2Enabled: true,
        crossChainMaxProviderCalls: 20
      }),
      job: job({ ...validProgressJson, sender: stage2BridgeSender, amountRaw: "100000000000" }),
      depositTxHash,
      watchedWallet: validProgressJson.watchedWallet,
      sender: stage2BridgeSender,
      amountRaw: "100000000000",
      timestamp: new Date(validProgressJson.timestamp)
    });

    expect(result.decision).toBe("DECLINE");
    expect(result.hardBadEvidence).toEqual([
      expect.objectContaining({
        kind: "sanctioned_service",
        evidenceIds: ["cross_chain:local:ethereum:sanctioned:service_boundary"]
      })
    ]);
    expect(result.reasons).toEqual(expect.arrayContaining([
      "Exact sanctioned service evidence found in cross-chain corridor.",
      "Bridge/router/DEX accounts for 100% of checked-deposit source share."
    ]));
    expect(result.reasons).toHaveLength(2);
  });

  it("keeps current incoming behavior and does not call Stage 2 providers when disabled", async () => {
    const provider = countingDiscoveryProvider({
      transfers: [incomingStage2Transfer()]
    });

    const result = await buildIncomingDepositReport({
      deps: stage2IncomingDeps({
        crossChainDiscoveryProvider: provider,
        evmEvidenceProvider: emptyEvmEvidenceProvider(),
        crossChainStage2Enabled: false,
        crossChainMaxProviderCalls: 20
      }),
      job: job({ ...validProgressJson, sender: stage2BridgeSender, amountRaw: "100000000000" }),
      depositTxHash,
      watchedWallet: validProgressJson.watchedWallet,
      sender: stage2BridgeSender,
      amountRaw: "100000000000",
      timestamp: new Date(validProgressJson.timestamp)
    });

    expect(provider.calls).toEqual([]);
    expect(result.hardBadEvidence).toEqual([]);
    expect(result.reasons.join(" ")).not.toContain("cross-chain");
    expect(result.warnings.join(" ")).not.toContain("Stage 2");
  });

  it("keeps normal clean CEX provenance on the fast pass", async () => {
    const cleanCex = "TBinanceFastClean11111111111111111111";

    const result = await buildIncomingDepositReport({
      deps: {
        listIndexedUsdtTransfersForAddress: async (address) =>
          address === validProgressJson.sender
            ? [indexedTransfer({
              txHash: "binance-fast-funding-1",
              fromAddress: cleanCex,
              toAddress: validProgressJson.sender,
              amountRaw: validProgressJson.amountRaw
            })]
            : [],
        listRelatedTrc20Transfers: async () => [],
        getLabelsForAddress: async () => [],
        getClassificationForAddress: async (address): Promise<ServiceClassification | null> =>
          address === cleanCex
            ? { category: "cex", identity: "Binance", confidence: "high", evidence: ["tag:binance"], isBoundary: true }
            : null,
        getContractIntelligenceProfile: async () => null,
        getTransaction: async () => ({}),
        getUsdtRestrictionStatus: async () => ({ ...stablecoinProfile(validProgressJson.sender), balanceRaw: "1000000" })
      },
      job: job(validProgressJson),
      depositTxHash,
      watchedWallet: validProgressJson.watchedWallet,
      sender: validProgressJson.sender,
      amountRaw: validProgressJson.amountRaw,
      timestamp: new Date(validProgressJson.timestamp)
    });

    expect(result.originPaths[0]).toEqual(expect.objectContaining({
      stoppedReason: "clean_cex_reached",
      proximityHops: 1
    }));
    expect(result.senderRole).toBe("clean_cex_funded_wallet");
    expect(result.warnings).not.toContain("Incoming deposit provenance search was extended beyond the fast depth budget.");
  });

  it("continues with partial report when sender transfer fetch is rate-limited", async () => {
    const result = await buildIncomingDepositReport({
      deps: {
        listIndexedUsdtTransfersForAddress: async () => {
          throw new Error("429 Too Many Requests");
        },
        listRelatedTrc20Transfers: async () => {
          throw new Error("AbortError: request aborted");
        },
        getLabelsForAddress: async () => [],
        getClassificationForAddress: async () => null,
        getContractIntelligenceProfile: async () => null,
        getTransaction: async () => ({}),
        getUsdtRestrictionStatus: async () => ({ ...stablecoinProfile(validProgressJson.sender), balanceRaw: "0" })
      },
      job: job(validProgressJson),
      depositTxHash,
      watchedWallet: validProgressJson.watchedWallet,
      sender: validProgressJson.sender,
      amountRaw: validProgressJson.amountRaw,
      timestamp: new Date(validProgressJson.timestamp)
    });

    expect(result.dataQuality).toBe("low");
    expect(result.warnings.join(" ")).toContain("indexed window transfer fetch failed");
    expect(result.warnings.join(" ")).toContain("live window transfer fetch failed");
  });

  it("uses live transfers when indexed cache fails", async () => {
    const cleanCex = "TBinanceLiveOnly111111111111111111111";

    const result = await buildIncomingDepositReport({
      deps: {
        listIndexedUsdtTransfersForAddress: async () => {
          throw new Error("429 Too Many Requests");
        },
        listRelatedTrc20Transfers: async (address) =>
          address === validProgressJson.sender
            ? [liveTransfer({
              transaction_id: "live-binance-funding-1",
              from_address: cleanCex,
              to_address: validProgressJson.sender,
              quant: validProgressJson.amountRaw
            })]
            : [],
        getLabelsForAddress: async () => [],
        getClassificationForAddress: async (address): Promise<ServiceClassification | null> =>
          address === cleanCex
            ? { category: "cex", identity: "Binance", confidence: "high", evidence: ["tag:binance"], isBoundary: true }
            : null,
        getContractIntelligenceProfile: async () => null,
        getTransaction: async () => ({}),
        getUsdtRestrictionStatus: async () => ({ ...stablecoinProfile(validProgressJson.sender), balanceRaw: "1000000" })
      },
      job: job(validProgressJson),
      depositTxHash,
      watchedWallet: validProgressJson.watchedWallet,
      sender: validProgressJson.sender,
      amountRaw: validProgressJson.amountRaw,
      timestamp: new Date(validProgressJson.timestamp)
    });

    expect(result.decision).toBe("ACCEPTABLE");
    expect(result.originPaths[0]).toEqual(expect.objectContaining({
      stoppedReason: "clean_cex_reached",
      txHashes: expect.arrayContaining(["live-binance-funding-1", depositTxHash])
    }));
  });

  it("uses indexed transfers when live provider fails", async () => {
    const cleanCex = "TBinanceIndexedOnly111111111111111111";

    const result = await buildIncomingDepositReport({
      deps: {
        listIndexedUsdtTransfersForAddress: async (address) =>
          address === validProgressJson.sender
            ? [indexedTransfer({
              txHash: "indexed-binance-funding-1",
              fromAddress: cleanCex,
              toAddress: validProgressJson.sender,
              amountRaw: validProgressJson.amountRaw
            })]
            : [],
        listRelatedTrc20Transfers: async () => {
          throw new Error("TronGrid provider unavailable");
        },
        getLabelsForAddress: async () => [],
        getClassificationForAddress: async (address): Promise<ServiceClassification | null> =>
          address === cleanCex
            ? { category: "cex", identity: "Binance", confidence: "high", evidence: ["tag:binance"], isBoundary: true }
            : null,
        getContractIntelligenceProfile: async () => null,
        getTransaction: async () => ({}),
        getUsdtRestrictionStatus: async () => ({ ...stablecoinProfile(validProgressJson.sender), balanceRaw: "1000000" })
      },
      job: job(validProgressJson),
      depositTxHash,
      watchedWallet: validProgressJson.watchedWallet,
      sender: validProgressJson.sender,
      amountRaw: validProgressJson.amountRaw,
      timestamp: new Date(validProgressJson.timestamp)
    });

    expect(result.decision).toBe("ACCEPTABLE");
    expect(result.originPaths[0]).toEqual(expect.objectContaining({
      stoppedReason: "clean_cex_reached",
      txHashes: expect.arrayContaining(["indexed-binance-funding-1", depositTxHash])
    }));
  });

  it("propagates non-recoverable transfer fetch errors", async () => {
    await expect(buildIncomingDepositReport({
      deps: {
        listIndexedUsdtTransfersForAddress: async () => {
          throw new Error("column indexed_tron_usdt_transfers.block_timestamp does not exist");
        },
        listRelatedTrc20Transfers: async () => [],
        getLabelsForAddress: async () => [],
        getClassificationForAddress: async () => null,
        getContractIntelligenceProfile: async () => null,
        getTransaction: async () => ({}),
        getUsdtRestrictionStatus: async () => ({ ...stablecoinProfile(validProgressJson.sender), balanceRaw: "0" })
      },
      job: job(validProgressJson),
      depositTxHash,
      watchedWallet: validProgressJson.watchedWallet,
      sender: validProgressJson.sender,
      amountRaw: validProgressJson.amountRaw,
      timestamp: new Date(validProgressJson.timestamp)
    })).rejects.toThrow("column indexed_tron_usdt_transfers.block_timestamp does not exist");
  });

  it("propagates non-recoverable upstream fetch errors from shared provenance", async () => {
    const upstream = "TUpstream111111111111111111111111111";
    await expect(buildIncomingDepositReport({
      deps: {
        listIndexedUsdtTransfersForAddress: async (address) => {
          if (address === validProgressJson.sender) {
            return [indexedTransfer({
              txHash: "sender-upstream-funding",
              fromAddress: upstream,
              toAddress: validProgressJson.sender,
              amountRaw: validProgressJson.amountRaw
            })];
          }
          if (address === upstream) {
            throw new Error("column indexed_tron_usdt_transfers.block_timestamp does not exist");
          }
          return [];
        },
        listRelatedTrc20Transfers: async () => [],
        getLabelsForAddress: async () => [],
        getClassificationForAddress: async () => null,
        getContractIntelligenceProfile: async () => null,
        getTransaction: async () => ({}),
        getUsdtRestrictionStatus: async () => ({ ...stablecoinProfile(validProgressJson.sender), balanceRaw: "0" })
      },
      job: job(validProgressJson),
      depositTxHash,
      watchedWallet: validProgressJson.watchedWallet,
      sender: validProgressJson.sender,
      amountRaw: validProgressJson.amountRaw,
      timestamp: new Date(validProgressJson.timestamp)
    })).rejects.toThrow("column indexed_tron_usdt_transfers.block_timestamp does not exist");
  });

  it("propagates unauthorized fetch failures", async () => {
    await expect(buildIncomingDepositReport({
      deps: {
        listIndexedUsdtTransfersForAddress: async () => {
          throw new Error("fetch failed: 401 Unauthorized");
        },
        listRelatedTrc20Transfers: async () => [],
        getLabelsForAddress: async () => [],
        getClassificationForAddress: async () => null,
        getContractIntelligenceProfile: async () => null,
        getTransaction: async () => ({}),
        getUsdtRestrictionStatus: async () => ({ ...stablecoinProfile(validProgressJson.sender), balanceRaw: "0" })
      },
      job: job(validProgressJson),
      depositTxHash,
      watchedWallet: validProgressJson.watchedWallet,
      sender: validProgressJson.sender,
      amountRaw: validProgressJson.amountRaw,
      timestamp: new Date(validProgressJson.timestamp)
    })).rejects.toThrow("fetch failed: 401 Unauthorized");
  });

  it("does not force low data quality when sender window succeeds but latest fallback fails", async () => {
    const cleanCex = "TBinanceLatestFallback111111111111111";

    const result = await buildIncomingDepositReport({
      deps: {
        listIndexedUsdtTransfersForAddress: async (address, options) => {
          if (options.minTimestamp?.getTime() === 0) {
            throw new Error("latest indexed fetch timeout");
          }
          return address === validProgressJson.sender
            ? [indexedTransfer({
              txHash: "window-binance-funding-1",
              fromAddress: cleanCex,
              toAddress: validProgressJson.sender,
              amountRaw: validProgressJson.amountRaw
            })]
            : [];
        },
        listRelatedTrc20Transfers: async (_address, options) => {
          if (options.minTimestamp === undefined) {
            throw new Error("latest live fetch timeout");
          }
          return [];
        },
        getLabelsForAddress: async () => [],
        getClassificationForAddress: async (address): Promise<ServiceClassification | null> =>
          address === cleanCex
            ? { category: "cex", identity: "Binance", confidence: "high", evidence: ["tag:binance"], isBoundary: true }
            : null,
        getContractIntelligenceProfile: async () => null,
        getTransaction: async () => ({}),
        getUsdtRestrictionStatus: async () => ({ ...stablecoinProfile(validProgressJson.sender), balanceRaw: "1000000" })
      },
      job: job(validProgressJson),
      depositTxHash,
      watchedWallet: validProgressJson.watchedWallet,
      sender: validProgressJson.sender,
      amountRaw: validProgressJson.amountRaw,
      timestamp: new Date(validProgressJson.timestamp)
    });

    expect(result.dataQuality).not.toBe("low");
    expect(result.warnings.join(" ")).toContain("indexed latest transfer fetch failed");
    expect(result.warnings.join(" ")).toContain("live latest transfer fetch failed");
  });

  it("uses deterministic service enrichment so final reports do not stay unresolved unknown risk", async () => {
    const contract = "TFcRN111111111111111111111111FLR5hvh";
    const analyzeLlm = vi.fn(async () => []);
    const enrichContractClassification = vi.fn(async () => ({
      address: contract,
      metadata: { address: contract, name: "GasFree", tag: "GasFree", isContract: true, verified: true },
      contractProfile: null,
      classification: {
        category: "service" as const,
        identity: "GasFree",
        confidence: "high" as const,
        evidence: ["metadata:GasFree"],
        isBoundary: true
      },
      profileSource: "none" as const,
      liveFetchError: null
    }));

    const result = await buildIncomingDepositReport({
      deps: {
        listIndexedUsdtTransfersForAddress: async (address) =>
          address === validProgressJson.sender
            ? [indexedTransfer({
              txHash: "gasfree-funding-1",
              fromAddress: contract,
              toAddress: validProgressJson.sender,
              amountRaw: "384064001319"
            })]
            : [],
        listRelatedTrc20Transfers: async () => [],
        getLabelsForAddress: async () => [],
        getClassificationForAddress: async (address): Promise<ServiceClassification | null> =>
          address === contract
            ? { category: "unknown_contract", identity: null, confidence: "medium", evidence: ["test contract"], isBoundary: true }
            : null,
        getContractIntelligenceProfile: async () => null,
        enrichContractClassification,
        getTransaction: async () => ({}),
        getUsdtRestrictionStatus: async () => ({ ...stablecoinProfile(validProgressJson.sender), balanceRaw: "0" }),
        analyzeContractLlmCaseFiles: analyzeLlm
      },
      job: job(validProgressJson),
      depositTxHash,
      watchedWallet: validProgressJson.watchedWallet,
      sender: validProgressJson.sender,
      amountRaw: validProgressJson.amountRaw,
      timestamp: new Date(validProgressJson.timestamp)
    });

    expect(result.decision).toBe("ACCEPTABLE");
    expect(result.depositRiskScore).toBe(35);
    expect(result.originPaths[0]?.stoppedReason).toBe("unknown_contract_reached");
    expect(result.freshBundleExposure).toMatchObject({
      unknownContractShare: 0,
      unknownShare: 1
    });
    expect(result.walletExposureProfile?.unknownContractVolumeShare).toBe(0);
    expect(result.walletExposureProfile?.scoreContribution).toBe(result.walletExposureProfile?.inOutVelocityScore);
    expect(result.walletExposureProfile?.reasons.join(" ")).not.toContain("unknown-contract volume");
    expect(result.unifiedRiskSummary).toMatchObject({
      freshBundleFloor: 0,
      corridorFloor: 0
    });
    expect(result.contractVerdicts[0]).toEqual(expect.objectContaining({
      source: "deterministic",
      verdict: "legitimate_service",
      decisionRecommendation: "ACCEPTABLE"
    }));
    expect(analyzeLlm).not.toHaveBeenCalled();
    expect(enrichContractClassification).toHaveBeenCalledWith(contract);
  });

  it("does not decline a 46K incoming deposit when only 4.06K is bridge-linked", async () => {
    const bridgeAddress = "TBridgeMinorIncoming111111111111111";
    const cleanAddress = "TBinanceMinorIncoming1111111111111";
    const amountRaw = "46000000000";

    const result = await buildIncomingDepositReport({
      deps: {
        listIndexedUsdtTransfersForAddress: async (address) =>
          address === validProgressJson.sender
            ? [
                indexedTransfer({
                  txHash: "minor-bridge-4060",
                  fromAddress: bridgeAddress,
                  toAddress: validProgressJson.sender,
                  amountRaw: "4060000000",
                  blockTimestamp: new Date("2026-05-29T13:00:00.000Z")
                }),
                indexedTransfer({
                  txHash: "minor-clean-41940",
                  fromAddress: cleanAddress,
                  toAddress: validProgressJson.sender,
                  amountRaw: "41940000000",
                  blockTimestamp: new Date("2026-05-29T12:50:00.000Z")
                })
              ]
            : [],
        listRelatedTrc20Transfers: async () => [],
        getLabelsForAddress: async () => [],
        getClassificationForAddress: async (address): Promise<ServiceClassification | null> => {
          if (address === bridgeAddress) {
            return { category: "bridge", identity: "Bridge", confidence: "high", evidence: ["test bridge"], isBoundary: true };
          }
          if (address === cleanAddress) {
            return { category: "cex", identity: "Binance Hot Wallet", confidence: "high", evidence: ["test cex"], isBoundary: true };
          }
          return null;
        },
        getContractIntelligenceProfile: async () => null,
        getTransaction: async () => ({}),
        getUsdtRestrictionStatus: async (address) => ({ ...stablecoinProfile(address), balanceRaw: "0" }),
        analyzeContractLlmCaseFiles: async (caseFiles) => caseFiles.map((caseFile, index): ContractLlmVerdictSummary => ({
          source: "llm",
          providerLabel: "test-llm",
          model: "test-model",
          contractAddress: caseFile.contractAddress,
          caseFileHash: `minor-bridge-case-${index}`,
          cacheId: null,
          verdict: "legitimate_service",
          confidence: 0.9,
          contractRiskScore: 10,
          decisionRecommendation: "ACCEPTABLE",
          reasons: ["Known service context."],
          citedEvidenceIds: [],
          falsePositiveNotes: []
        }))
      },
      job: job({
        ...validProgressJson,
        amountRaw,
        amount: "46000"
      }),
      depositTxHash,
      watchedWallet: validProgressJson.watchedWallet,
      sender: validProgressJson.sender,
      amountRaw,
      timestamp: new Date(validProgressJson.timestamp)
    });

    const bridgeEvidence = result.sourcePolicyEvidence?.find((evidence) => evidence.kind === "bridge_router_dex");
    const bridgePath = result.originPaths.find((path) => path.sourcePolicyShareDetail?.affectedAmountRaw === "4060000000");

    expect(result.decision).not.toBe("DECLINE");
    expect(result.depositRiskScore).toBeLessThan(45);
    expect(bridgeEvidence?.shareDetail).toMatchObject({
      scope: "where_selected_amount",
      targetAmountRaw: amountRaw,
      affectedAmountRaw: "4060000000",
      shareCap: 30
    });
    expect(bridgePath?.sourcePolicyShareDetail).toMatchObject({
      affectedAmountRaw: "4060000000",
      targetAmountRaw: amountRaw
    });
    expect(bridgePath?.balanceShare).toBeCloseTo(0.08826086956521739);
  });

  it("keeps unresolved unknown-contract provenance acceptable below the unified decline threshold", async () => {
    const contract = "TUnknown1111111111111111111111111111";
    const enrichContractClassification = vi.fn(async () => ({
      address: contract,
      metadata: null,
      contractProfile: null,
      classification: {
        category: "unknown_contract" as const,
        identity: null,
        confidence: "medium" as const,
        evidence: ["test contract"],
        isBoundary: true
      },
      profileSource: "none" as const,
      liveFetchError: null
    }));

    const result = await buildIncomingDepositReport({
      deps: {
        listIndexedUsdtTransfersForAddress: async (address) =>
          address === validProgressJson.sender
            ? [indexedTransfer({
              txHash: "unknown-contract-funding-1",
              fromAddress: contract,
              toAddress: validProgressJson.sender,
              amountRaw: "384064001319"
            })]
            : [],
        listRelatedTrc20Transfers: async () => [],
        getLabelsForAddress: async () => [],
        getClassificationForAddress: async (address): Promise<ServiceClassification | null> =>
          address === contract
            ? { category: "unknown_contract", identity: null, confidence: "medium", evidence: ["test contract"], isBoundary: true }
            : null,
        getContractIntelligenceProfile: async () => null,
        enrichContractClassification,
        getTransaction: async () => ({}),
        getUsdtRestrictionStatus: async () => ({ ...stablecoinProfile(validProgressJson.sender), balanceRaw: "0" })
      },
      job: job(validProgressJson),
      depositTxHash,
      watchedWallet: validProgressJson.watchedWallet,
      sender: validProgressJson.sender,
      amountRaw: validProgressJson.amountRaw,
      timestamp: new Date(validProgressJson.timestamp)
    });

    expect(result.depositRiskScore).toBeLessThan(60);
    expect(result.decision).toBe("ACCEPTABLE");
    expect(result.unifiedRiskSummary?.finalScore).toBe(result.depositRiskScore);
    expect(result.unifiedRiskSummary?.finalDecision).toBe(result.decision);
    expect(result.contractVerdicts[0]).toEqual(expect.objectContaining({
      source: "unavailable",
      verdict: "unknown_insufficient_data",
      error: "llm disabled"
    }));
    expect(result.reasons.join(" ")).toContain("LLM unavailable: llm disabled");
  });

  it("treats enriched hot_wallet contracts as deterministic service context", async () => {
    const contract = "THotWallet11111111111111111111111111";
    const analyzeLlm = vi.fn(async () => []);
    const enrichContractClassification = vi.fn(async () => ({
      address: contract,
      metadata: { address: contract, name: "Known Hot Wallet", tag: "Hot Wallet", isContract: true, verified: true },
      contractProfile: null,
      classification: {
        category: "hot_wallet" as const,
        identity: "Known Hot Wallet",
        confidence: "high" as const,
        evidence: ["metadata:hot_wallet"],
        isBoundary: true
      },
      profileSource: "none" as const,
      liveFetchError: null
    }));

    const result = await buildIncomingDepositReport({
      deps: {
        listIndexedUsdtTransfersForAddress: async (address) =>
          address === validProgressJson.sender
            ? [indexedTransfer({
              txHash: "hot-wallet-funding-1",
              fromAddress: contract,
              toAddress: validProgressJson.sender,
              amountRaw: "384064001319"
            })]
            : [],
        listRelatedTrc20Transfers: async () => [],
        getLabelsForAddress: async () => [],
        getClassificationForAddress: async (address): Promise<ServiceClassification | null> =>
          address === contract
            ? { category: "unknown_contract", identity: null, confidence: "medium", evidence: ["test contract"], isBoundary: true }
            : null,
        getContractIntelligenceProfile: async () => null,
        enrichContractClassification,
        getTransaction: async () => ({}),
        getUsdtRestrictionStatus: async () => ({ ...stablecoinProfile(validProgressJson.sender), balanceRaw: "0" }),
        analyzeContractLlmCaseFiles: analyzeLlm
      },
      job: job(validProgressJson),
      depositTxHash,
      watchedWallet: validProgressJson.watchedWallet,
      sender: validProgressJson.sender,
      amountRaw: validProgressJson.amountRaw,
      timestamp: new Date(validProgressJson.timestamp)
    });

    expect(result.contractVerdicts[0]).toEqual(expect.objectContaining({
      source: "deterministic",
      verdict: "legitimate_service",
      decisionRecommendation: "ACCEPTABLE"
    }));
    expect(analyzeLlm).not.toHaveBeenCalled();
  });

  it("uses hard-boundary enrichment in final reports without an LLM call", async () => {
    const contract = "TFcRN111111111111111111111111FLR5hvh";
    const analyzeLlm = vi.fn(async () => []);
    const enrichContractClassification = vi.fn(async () => ({
      address: contract,
      metadata: { address: contract, name: "HTX", tag: "HTX", isContract: true, verified: true },
      contractProfile: null,
      classification: {
        category: "cex" as const,
        identity: "HTX",
        confidence: "high" as const,
        evidence: ["metadata:HTX"],
        isBoundary: true
      },
      profileSource: "none" as const,
      liveFetchError: null
    }));

    const result = await buildIncomingDepositReport({
      deps: {
        listIndexedUsdtTransfersForAddress: async (address) =>
          address === validProgressJson.sender
            ? [indexedTransfer({
              txHash: "htx-funding-1",
              fromAddress: contract,
              toAddress: validProgressJson.sender,
              amountRaw: "384064001319"
            })]
            : [],
        listRelatedTrc20Transfers: async () => [],
        getLabelsForAddress: async () => [],
        getClassificationForAddress: async (address): Promise<ServiceClassification | null> =>
          address === contract
            ? { category: "unknown_contract", identity: null, confidence: "medium", evidence: ["test contract"], isBoundary: true }
            : null,
        getContractIntelligenceProfile: async () => null,
        enrichContractClassification,
        getTransaction: async () => ({}),
        getUsdtRestrictionStatus: async () => ({ ...stablecoinProfile(validProgressJson.sender), balanceRaw: "0" }),
        analyzeContractLlmCaseFiles: analyzeLlm
      },
      job: job(validProgressJson),
      depositTxHash,
      watchedWallet: validProgressJson.watchedWallet,
      sender: validProgressJson.sender,
      amountRaw: validProgressJson.amountRaw,
      timestamp: new Date(validProgressJson.timestamp)
    });

    expect(result.decision).toBe("DECLINE");
    expect(result.originPaths[0]).toEqual(expect.objectContaining({
      stoppedReason: "htx_huobi_reached",
      sourcePolicy: "hard_decline"
    }));
    expect(result.hardBadEvidence).toEqual([]);
    expect(result.depositRiskScore).toBeGreaterThanOrEqual(78);
    expect(result.reasons.join(" ")).toContain("source-policy risk");
    expect(analyzeLlm).not.toHaveBeenCalled();
    expect(enrichContractClassification).toHaveBeenCalledWith(contract);
  });
});

function provenanceChain(hops: number, origin: string): { origin: string; transfersByRecipient: Map<string, IndexedTronUsdtTransfer[]> } {
  const addresses = [
    validProgressJson.sender,
    ...Array.from({ length: hops - 1 }, (_, index) => `TDepthHop${String(index + 1).padStart(2, "0")}1111111111111111111111`),
    origin
  ];
  const transfersByRecipient = new Map<string, IndexedTronUsdtTransfer[]>();
  const depositTime = new Date(validProgressJson.timestamp).getTime();

  for (let index = 0; index < hops; index += 1) {
    const transfer = indexedTransfer({
      txHash: `depth-funding-${index + 1}`,
      fromAddress: addresses[index + 1],
      toAddress: addresses[index],
      amountRaw: validProgressJson.amountRaw,
      blockTimestamp: new Date(depositTime - (index + 1) * 60_000)
    });
    transfersByRecipient.set(addresses[index], [transfer]);
  }

  return { origin, transfersByRecipient };
}

function incomingStage2Transfer(overrides: Partial<CrossChainTransfer> = {}): CrossChainTransfer {
  return {
    id: "range-incoming-tron-ethereum-usdt",
    protocol: "LayerZero/Stargate",
    source: {
      chain: "tron",
      chainId: "tron-mainnet",
      address: stage2BridgeSender
    },
    destination: {
      chain: "ethereum",
      chainId: 1,
      address: stage2EthereumActor
    },
    sourceTxHash: depositTxHash,
    destinationTxHash: "0xstage2",
    assetSymbol: "USDT",
    amountRaw: "100000000000",
    decimals: 6,
    timestamp: "2026-05-29T14:00:30.000Z",
    evidenceRefs: [{
      id: "cross_chain:range:ethereum:0xstage2:bridge_destination",
      provider: "range",
      payloadId: "range:tx:incoming-stage2",
      confidence: "provider_correlated"
    }],
    payloadRef: {
      id: "range:tx:incoming-stage2",
      provider: "range",
      endpoint: "transfers/by-tx",
      fetchedAt: "2026-06-01T00:00:00.000Z"
    },
    labels: ["LayerZero", "Stargate"],
    ...overrides
  };
}

function incomingStage2RiskSnapshot(overrides: Partial<ProviderRiskSnapshot> = {}): ProviderRiskSnapshot {
  return {
    address: {
      chain: "ethereum",
      chainId: 1,
      address: stage2SanctionedActor
    },
    provider: "local",
    riskScore: 100,
    labels: ["LOCAL_EXACT_SANCTIONED: OFAC SDN sanctioned service"],
    evidenceRefs: [{
      id: "cross_chain:local:ethereum:sanctioned:service_boundary",
      provider: "local",
      payloadId: null,
      confidence: "exact"
    }],
    payloadRef: null,
    ...overrides
  };
}

function countingDiscoveryProvider(data: {
  transfers?: readonly CrossChainTransfer[];
  riskSnapshots?: readonly ProviderRiskSnapshot[];
}): CrossChainDiscoveryProvider & { calls: string[] } {
  const provider = createFixtureCrossChainDiscoveryProvider({
    transfers: data.transfers ?? [],
    riskSnapshots: data.riskSnapshots ?? []
  });
  const calls: string[] = [];
  return {
    calls,
    async findTransfersByTx(query) {
      calls.push(`tx:${query.txHash}`);
      return provider.findTransfersByTx(query);
    },
    async findTransfersByAddress(query) {
      calls.push(`address:${query.address}`);
      return provider.findTransfersByAddress(query);
    },
    async getAddressRisk(query) {
      calls.push(`risk:${query.address}`);
      return provider.getAddressRisk(query);
    }
  };
}

function emptyEvmEvidenceProvider(overrides: Partial<EvmEvidenceProvider> = {}): EvmEvidenceProvider {
  return {
    async listNormalTransactions() {
      return [];
    },
    async listInternalTransactions() {
      return [];
    },
    async listErc20Transfers() {
      return [];
    },
    async getTransactionReceipt() {
      return null;
    },
    async getLogs() {
      return [];
    },
    async getTokenMetadata() {
      return null;
    },
    ...overrides
  };
}

function incomingStage2Receipt(overrides: Partial<EvmTransactionReceipt> = {}): EvmTransactionReceipt {
  return {
    chain: "ethereum",
    transactionHash: "0xgary",
    to: stage2UniswapV3Npm,
    logs: [{
      chain: "ethereum",
      address: stage2UniswapV3Npm,
      topics: [stage2DecreaseLiquidityTopic],
      data: "0x",
      blockNumber: "22500000",
      transactionHash: "0xgary",
      logIndex: "0"
    } satisfies EvmLog],
    status: "1",
    ...overrides
  };
}

function incomingStage2TokenTransfer(overrides: Partial<EvmTokenTransfer> = {}): EvmTokenTransfer {
  return {
    chain: "ethereum",
    hash: "0xgary",
    from: stage2GaryActor,
    to: stage2UniswapV3Npm,
    contractAddress: "0xgary000000000000000000000000000000000000",
    value: "1000000000000000000",
    tokenSymbol: "GARY",
    tokenDecimal: "18",
    ...overrides
  };
}

function incomingStage2TokenMetadata(symbol: string, tokenContract = `0x${symbol.toLowerCase().padEnd(40, "0")}`): EvmTokenMetadata {
  return {
    chain: "ethereum",
    tokenContract,
    tokenName: `${symbol} token`,
    tokenSymbol: symbol,
    tokenDecimal: "18"
  };
}

function noNameLiquidityEvmProvider(): EvmEvidenceProvider {
  return emptyEvmEvidenceProvider({
    async listNormalTransactions() {
      return [{
        chain: "ethereum",
        hash: "0xgary",
        from: stage2GaryActor,
        to: stage2UniswapV3Npm,
        value: "0",
        functionName: "decreaseLiquidity(uint256 tokenId)"
      } satisfies EvmTransaction];
    },
    async listInternalTransactions() {
      return [{
        chain: "ethereum",
        hash: "0xgary",
        from: stage2UniswapV3Npm,
        to: stage2GaryActor,
        value: "247770000000000000000"
      } satisfies EvmInternalTransaction];
    },
    async listErc20Transfers() {
      return [
        incomingStage2TokenTransfer(),
        incomingStage2TokenTransfer({
          contractAddress: "0xweth000000000000000000000000000000000000",
          tokenSymbol: "WETH"
        })
      ];
    },
    async getTransactionReceipt({ txHash }) {
      return txHash === "0xgary" ? incomingStage2Receipt() : null;
    },
    async getTokenMetadata({ tokenContract }) {
      return tokenContract.includes("gary")
        ? incomingStage2TokenMetadata("GARY", tokenContract)
        : incomingStage2TokenMetadata("WETH", tokenContract);
    }
  });
}

function stage2IncomingDeps(overrides: Partial<IncomingDepositRuntimeDeps> = {}): IncomingDepositRuntimeDeps {
  return {
    listIndexedUsdtTransfersForAddress: async () => [],
    listRelatedTrc20Transfers: async () => [],
    getLabelsForAddress: async () => [],
    getClassificationForAddress: async (address): Promise<ServiceClassification | null> =>
      address === stage2BridgeSender
        ? { category: "bridge", identity: "LayerZero/Stargate", confidence: "high", evidence: ["tag:stargate"], isBoundary: true }
        : null,
    getContractIntelligenceProfile: async () => null,
    getTransaction: async () => ({}),
    getUsdtRestrictionStatus: async (address) => ({ ...stablecoinProfile(address), balanceRaw: "0" }),
    ...overrides
  };
}

function stablecoinProfile(subjectAddress: string): StablecoinRestrictionProfile {
  return {
    subjectAddress,
    tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    tokenSymbol: "USDT",
    tokenStandard: "TRC20",
    decimals: 6,
    isBlacklisted: false,
    balanceRaw: null,
    checkedAt: "2026-05-29T14:02:00.000Z",
    evidenceStrength: "exact_contract_state",
    methods: {
      blacklist: "isBlackListed(address)",
      balance: "balanceOf(address)"
    }
  };
}
