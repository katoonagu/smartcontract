import { describe, expect, it, vi } from "vitest";
import { TronWeb } from "tronweb";
import { TRON_USDT_CONTRACT_ADDRESS, type RawTronscanTrc20Transfer } from "../../src/parser/transactionParser";
import type { ForensicCheckJob } from "../../src/storage/repositories";
import type { DeepAddressForensicReport } from "../../src/check/deepForensicCheck";
import {
  buildIncomingDepositReport,
  runSingleIncomingDepositJobCycle as runSingleIncomingDepositJobCycleImpl,
  type BuildIncomingDepositReportInput,
  type IncomingDepositRuntimeDeps,
  type RunSingleIncomingDepositJobCycleDeps
} from "../../src/forensics/incomingDepositJob";
import { TargetedHistoryWaitingForIndex } from "../../src/forensics/targetedHistoryCoordinator";
import { buildScoringAuditRow } from "../../src/risk/scoringAudit";
import { SCORING_SIGNAL_MATRIX_POLICY_VERSION } from "../../src/risk/scoringSignalMatrix";
import {
  createSelectiveTransactionEnricher,
  type SelectiveTransactionEnrichmentInput
} from "../../src/forensics/selectiveTransactionEnrichment";
import { createForensicEnrichmentHeartbeatCoordinator } from "../../src/forensics/forensicJobProgress";
import {
  transactionProviderEvidenceId,
  type TronTransactionProviderEvidenceV1
} from "../../src/storage/transactionEvidenceRepository";
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
  ForensicRouteEdge,
  IncomingDepositRiskReport,
  IndexedTronUsdtTransfer,
  ServiceClassification,
  StablecoinRestrictionProfile,
  TronAddressUsdtIndexState
} from "../../src/types";

const depositTxHash = "48d33ccf504fd97aa741dcbc2e4cccb7225e1bf7859b64d385a338df91ce0c3b";
const watchedWalletId = "wallet-1";
const incomingSenderAddress = "TWYSVbUy6eTu6ZrFWRUimgDy9SinkggVKL";
const stage2BridgeSender = "TCo75zcxTuWn5nnFqZUeK5socdVnG11f2T";
const stage2EthereumActor = "0x2222222222222222222222222222222222222222";
const stage2GaryActor = "0x3333333333333333333333333333333333333333";
const stage2SanctionedActor = "0x5555555555555555555555555555555555555555";
const stage2UniswapV3Npm = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";
const stage2DecreaseLiquidityTopic = "0x26f6a8ec6d85944b0b35836d2ca9c7468e4bf0b1f2a1c23f0b6d3c673dbc8f2";
const gasFreeController = "TFFAMQLZybALaLb4uxHA9RBE7pxhUAjF3U";
const gasFreeAccount = "TRivmRsLwVRZETXqPdv98raFPHMkwuMnxP";
const gasFreeUser = "TW2Py9fWGc1HVXhejufX1stuwQ9N42Y8RE";
const gasFreeReceiver = "TMwjbNHpsVSjn93vtWtLnThHwhAJAnrWNq";
const gasFreeTlnt = "TLntW9Z59LYY5KEi9cmwk3PKjQga828ird";

const gasFreeUintWord = (value: bigint): string => value.toString(16).padStart(64, "0");
const gasFreeAddressWord = (address: string): string => TronWeb.address.toHex(address).slice(2).padStart(64, "0");

function gasFreePermitData(receiverAddress: string, value: bigint, maxFee: bigint): string {
  return [
    "6f21b898",
    gasFreeAddressWord(TRON_USDT_CONTRACT_ADDRESS),
    gasFreeAddressWord(gasFreeUser),
    gasFreeAddressWord(receiverAddress),
    gasFreeUintWord(value),
    gasFreeUintWord(maxFee),
    gasFreeUintWord(1_800_000_000n),
    gasFreeUintWord(1n),
    gasFreeUintWord(9n),
    gasFreeUintWord(0x120n),
    gasFreeUintWord(65n),
    "11".repeat(65).padEnd(192, "0")
  ].join("");
}

function gasFreeTransaction(
  receiverAddress = gasFreeReceiver,
  principalAmountRaw = "97000000",
  feeAmountRaw = "3000000"
) {
  const row = (toAddress: string, amountRaw: string) => ({
    from_address: gasFreeAccount,
    to_address: toAddress,
    amount_str: amountRaw,
    contract_address: TRON_USDT_CONTRACT_ADDRESS,
    status: 0,
    tokenInfo: { tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenAbbr: "USDT", tokenType: "trc20" }
  });
  const rows = [row(receiverAddress, principalAmountRaw), row(gasFreeTlnt, feeAmountRaw)];
  return {
    confirmed: true,
    contractRet: "SUCCESS",
    revert: false,
    contractData: {
      contract_address: gasFreeController,
      data: gasFreePermitData(receiverAddress, BigInt(principalAmountRaw), BigInt(feeAmountRaw))
    },
    trc20TransferInfo: rows,
    tokenTransferInfo: rows.map((item) => ({ ...item }))
  };
}

const validProgressJson = {
  depositTxHash,
  watchedWallet: "TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM",
  watchedWalletId,
  sender: incomingSenderAddress,
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
    scoreValid: true,
    scoreBlockedReason: null,
    technicalStatus: "completed",
    depositRiskScore: 32,
    observedContextScore: 32,
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

function failurePayload(text = "incoming-failed") {
  return {
    version: "telegram-message-payload-v1" as const,
    chatId: "42",
    text,
    parseMode: "HTML" as const,
    replyMarkup: null
  };
}

function job(progressJson: Record<string, unknown>): ForensicCheckJob {
  return {
    id: "job-incoming-1",
    kind: "incoming_deposit_check",
    subjectAddress: incomingSenderAddress,
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

type IncomingDepositJobTestDeps = Omit<
  RunSingleIncomingDepositJobCycleDeps,
  "hasUndismissedAddressPoisoningCandidateForIncoming"
> & Partial<Pick<
  RunSingleIncomingDepositJobCycleDeps,
  "hasUndismissedAddressPoisoningCandidateForIncoming"
>>;

function runSingleIncomingDepositJobCycle(deps: IncomingDepositJobTestDeps): Promise<boolean> {
  return runSingleIncomingDepositJobCycleImpl({
    hasUndismissedAddressPoisoningCandidateForIncoming: async () => false,
    ...deps
  });
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

async function runCompleteIncomingTargetedMaterializationScenario(input: {
  hopRows: IndexedTronUsdtTransfer[] | ((context: {
    hub: string;
    upstreamSource: string;
    fundingTimestamp: Date;
    amountRaw: string;
  }) => IndexedTronUsdtTransfer[]);
  throwOnHopRead?: boolean;
  localIndexMaterializationMaxRows?: number;
  amountRaw?: string;
  coveringStateOnly?: boolean;
  senderBlacklisted?: boolean;
  receiverDeepReport?: DeepAddressForensicReport | null;
}) {
  const hub = "TIncomingMaterializedHub111111111111111";
  const upstreamSource = "TIncomingMaterializedCex111111111111111";
  const fundingTimestamp = new Date("2026-05-29T13:30:00.000Z");
  const amountRaw = input.amountRaw ?? validProgressJson.amountRaw;
  const hopRows = typeof input.hopRows === "function"
    ? input.hopRows({ hub, upstreamSource, fundingTimestamp, amountRaw })
    : input.hopRows;
  const indexOffsets: number[] = [];
  const indexDirections: string[] = [];
  let targetedLiveProviderCalls = 0;
  const queueAddressUsdtHistory = vi.fn(async (
    request: Parameters<NonNullable<IncomingDepositRuntimeDeps["queueAddressUsdtHistory"]>>[0]
  ) => queuedTargetedIndexState({
    address: request.address,
    targetTimestamp: request.targetTimestamp,
    requestedByJobId: request.requestedByJobId,
    queuedReason: request.queuedReason
  }));
  const releaseForensicCheckJobToWaiting = vi.fn(async () => true);
  const listIndexedUsdtTransfersForAddress = vi.fn(async (
    address: string,
    options: Parameters<IncomingDepositRuntimeDeps["listIndexedUsdtTransfersForAddress"]>[1]
  ) => {
    if (address === validProgressJson.sender) {
      return [indexedTransfer({
        txHash: "materialized-hub-funded-sender",
        fromAddress: hub,
        toAddress: validProgressJson.sender,
        amountRaw,
        blockTimestamp: fundingTimestamp
      })];
    }
    if (address !== hub || options.maxTimestamp?.getTime() !== fundingTimestamp.getTime()) return [];
    indexOffsets.push(options.offset ?? 0);
    indexDirections.push(options.direction);
    if (input.throwOnHopRead) throw new Error("local index temporarily unavailable");
    const offset = options.offset ?? 0;
    return hopRows.slice(offset, offset + options.limit);
  });
  const listRelatedTrc20Transfers = vi.fn(async (
    address: string,
    options: Parameters<IncomingDepositRuntimeDeps["listRelatedTrc20Transfers"]>[1]
  ) => {
    if (address === hub && options.endTimestamp === fundingTimestamp.getTime()) {
      targetedLiveProviderCalls += 1;
    }
    return [];
  });
  const completeCoveringState = (): TronAddressUsdtIndexState => ({
    ...queuedTargetedIndexState({
      address: hub,
      targetTimestamp: fundingTimestamp,
      requestedByJobId: "job-incoming-1",
      queuedReason: "incoming_deposit_hop"
    }),
    requestKind: "broad_targeted",
    status: "complete",
    statusReason: "complete_provider_windowed",
    completedAt: new Date("2026-07-02T00:00:00.000Z")
  });
  const getAddressUsdtIndexState = vi.fn(async (request) => request.address === hub &&
    request.targetTimestamp?.getTime() === fundingTimestamp.getTime() &&
    input.coveringStateOnly !== true
    ? completeCoveringState()
    : null);
  const getCoveringAddressUsdtIndexState = vi.fn(async (request) => request.address === hub &&
    request.targetTimestamp.getTime() === fundingTimestamp.getTime()
    ? completeCoveringState()
    : null);
  const ensureAddressUsdtHistory = vi.fn(async (request) => ({
    ...queuedTargetedIndexState({
      address: request.address,
      targetTimestamp: request.targetTimestamp,
      requestedByJobId: request.requestedByJobId,
      queuedReason: request.queuedReason
    }),
    status: "partial" as const,
    statusReason: "partial_provider_cap" as const,
    providerCapHit: true
  }));

  const result = await buildIncomingDepositReport({
    deps: {
      listIndexedUsdtTransfersForAddress,
      listRelatedTrc20Transfers,
      ensureAddressUsdtHistory,
      getAddressUsdtIndexState,
      getCoveringAddressUsdtIndexState,
      queueAddressUsdtHistory,
      releaseForensicCheckJobToWaiting,
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async (address): Promise<ServiceClassification | null> =>
        address === upstreamSource
          ? { category: "cex", identity: "Binance", confidence: "high", evidence: ["tag:binance"], isBoundary: true }
          : null,
      getContractIntelligenceProfile: async () => null,
      getTransaction: async () => ({}),
      getUsdtRestrictionStatus: async (address) => ({
        ...stablecoinProfile(address),
        isBlacklisted: input.senderBlacklisted === true,
        balanceRaw: "1000000"
      })
    },
    job: job({ ...validProgressJson, amountRaw }),
    depositTxHash,
    watchedWallet: validProgressJson.watchedWallet,
    sender: validProgressJson.sender,
    amountRaw,
    timestamp: new Date(validProgressJson.timestamp),
    receiverDeepReport: input.receiverDeepReport,
    localIndexMaterializationMaxRows: input.localIndexMaterializationMaxRows,
    persistProgress: async (patch) => patch
  });

  return {
    result,
    hub,
    upstreamSource,
    fundingTimestamp,
    indexOffsets,
    indexDirections,
    targetedLiveProviderCalls,
    ensureAddressUsdtHistory,
    getAddressUsdtIndexState,
    getCoveringAddressUsdtIndexState,
    queueAddressUsdtHistory,
    releaseForensicCheckJobToWaiting
  };
}

function incomingMaterializationRows(input: {
  hub: string;
  upstreamSource: string;
  fundingTimestamp: Date;
  amountRaw: string;
}): IndexedTronUsdtTransfer[] {
  return [
    ...Array.from({ length: 200 }, (_, index) => indexedTransfer({
      txHash: `materialized-filler-${index}`,
      eventIndex: index,
      fromAddress: `TIncomingFiller${index}`,
      toAddress: input.hub,
      amountRaw: "1",
      blockTimestamp: new Date(input.fundingTimestamp.getTime() - ((index + 1) * 1_000))
    })),
    indexedTransfer({
      txHash: "materialized-row-201-upstream",
      eventIndex: 200,
      fromAddress: input.upstreamSource,
      toAddress: input.hub,
      amountRaw: input.amountRaw,
      blockTimestamp: new Date("2026-05-29T13:20:00.000Z")
    })
  ];
}

describe("runSingleIncomingDepositJobCycle", () => {
  it("rejects a claimed job without a claim generation", async () => {
    await expect(runSingleIncomingDepositJobCycle({
      claimNextForensicCheckJob: async () => ({ ...job(validProgressJson), startedAt: null })
    } as unknown as Parameters<typeof runSingleIncomingDepositJobCycle>[0]))
      .rejects.toThrow("claimed_forensic_job_missing_started_at");
  });

  it("queues one latest final heartbeat behind an unresolved periodic job heartbeat", async () => {
    let releasePeriodic!: () => void;
    let signalPeriodicStarted!: () => void;
    const periodicStarted = new Promise<void>((resolve) => { signalPeriodicStarted = resolve; });
    const periodicGate = new Promise<void>((resolve) => { releasePeriodic = resolve; });
    const writes: Array<{ kind: string; progress: { completed: number; total: number } | null }> = [];
    let activeWrites = 0;
    let maxActiveWrites = 0;
    const coordinator = createForensicEnrichmentHeartbeatCoordinator({
      intervalMs: 1,
      heartbeat: async (write) => {
        activeWrites += 1;
        maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
        writes.push(write);
        try {
          if (write.kind === "periodic") {
            signalPeriodicStarted();
            await periodicGate;
          }
        } finally {
          activeWrites -= 1;
        }
      }
    });

    const run = coordinator.run(async (onCandidateResolved) => {
      await periodicStarted;
      await Promise.all([
        onCandidateResolved({ completed: 1, total: 1 }),
        onCandidateResolved({ completed: 2, total: 2 })
      ]);
    });
    await periodicStarted;
    expect(writes).toEqual([{ kind: "periodic", progress: null }]);
    releasePeriodic();
    await run;
    await coordinator.dispose();

    expect(maxActiveWrites).toBe(1);
    expect(writes).toEqual([
      { kind: "periodic", progress: null },
      { kind: "final", progress: { completed: 2, total: 2 } }
    ]);
  });

  it("completes an incoming deposit job with one pending final alert", async () => {
    const events: string[] = [];
    const complete = vi.fn(async (input: Parameters<RunSingleIncomingDepositJobCycleDeps["completeForensicCheckJob"]>[0]) => {
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
      buildReport: async () => report({
        transactionInfoEnrichment: {
          policyVersion: "selective-transaction-enrichment-v1",
          coverageStatus: "complete",
          technicalStatus: "proven",
          candidateCount: 1,
          hardCandidateCount: 0,
          rawProviderRequests: 1,
          fullProviderRequests: 0,
          savedEvidenceHits: 0,
          inFlightHits: 0,
          schedulerAwaitMs: 0,
          evidenceIds: ["incoming:raw", "incoming:decision"],
          decisions: []
        }
      })
    });

    expect(handled).toBe(true);
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ status: "completed" }));
    const completion = complete.mock.calls[0]?.[0];
    if (!completion) throw new Error("expected incoming completion");
    expect(completion.resultJson.scoringPolicyVersion).toBe(SCORING_SIGNAL_MATRIX_POLICY_VERSION);
    expect(completion.rawEvidenceIds).toEqual(["incoming:raw", "incoming:decision"]);
    expect(buildScoringAuditRow({
      ...job(validProgressJson),
      status: "completed",
      resultJson: completion.resultJson,
      completedAt: new Date("2026-05-29T14:03:00.000Z")
    }).policyVersion).toBe(SCORING_SIGNAL_MATRIX_POLICY_VERSION);
    expect(send).not.toHaveBeenCalled();
    expect(markSent).not.toHaveBeenCalled();
    expect(completion.progressJson.telegramDelivery).toMatchObject({
      payload: {
        version: "telegram-message-payload-v1",
        chatId: "42",
        text: "<b>Incoming USDT</b>",
        parseMode: "HTML",
        replyMarkup: null
      },
      effect: {
        kind: "incoming_user_alert",
        watchedWalletId,
        incomingTxHash: depositTxHash
      },
      state: { status: "pending", attemptCount: 0 },
      claim: null
    });
    expect(formatAlert).toHaveBeenCalledWith(expect.objectContaining({
      timestamp: new Date("2026-05-29T14:01:00.000Z"),
      locale: "en"
    }));
    expect(events).toEqual(["complete:completed"]);
  });

  it("looks up the exact incoming poisoning candidate immediately before formatting and preserves AML output", async () => {
    const events: string[] = [];
    const lookup = vi.fn(async () => {
      events.push("lookup");
      return true;
    });
    const formatAlert = vi.fn((input: Parameters<RunSingleIncomingDepositJobCycleDeps["formatIncomingDepositRiskAlert"]>[0]) => {
      events.push("format");
      return {
        text: input.addressPoisoningWarningActive ? "warning-active" : "ordinary",
        parseMode: "HTML" as const
      };
    });
    const buildReport = vi.fn(async (input: Parameters<RunSingleIncomingDepositJobCycleDeps["buildReport"]>[0]) => {
      events.push("build");
      expect(input).not.toHaveProperty("addressPoisoningWarningActive");
      return report();
    });
    const complete = vi.fn(async (input: Parameters<RunSingleIncomingDepositJobCycleDeps["completeForensicCheckJob"]>[0]) => {
      events.push("complete");
      expect(input.resultJson).toEqual(expect.objectContaining({
        decision: "ACCEPTABLE",
        depositRiskScore: 32
      }));
      return true;
    });
    const send = vi.fn(async (_telegramUserId: string, message: string) => {
      events.push("send");
      expect(message).toBe("warning-active");
    });

    await runSingleIncomingDepositJobCycle({
      claimNextForensicCheckJob: async () => job(validProgressJson),
      completeForensicCheckJob: complete,
      markUserAlertSent: async () => true,
      markUserAlertFailed: async () => true,
      recordObservedTransactionRisk: async () => {
        events.push("record");
        return true;
      },
      hasUndismissedAddressPoisoningCandidateForIncoming: lookup,
      sendUserAlert: send,
      formatIncomingDepositRiskAlert: formatAlert,
      buildReport
    });

    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith({ watchedWalletId, incomingTxHash: depositTxHash });
    expect(formatAlert).toHaveBeenCalledWith(expect.objectContaining({ addressPoisoningWarningActive: true }));
    expect(send).not.toHaveBeenCalled();
    expect(complete.mock.calls[0]?.[0].progressJson.telegramDelivery).toMatchObject({
      payload: { text: "warning-active" }
    });
    expect(events).toEqual(["build", "record", "lookup", "format", "complete"]);
  });

  it("does not wait or retry when no active poisoning candidate exists", async () => {
    const lookup = vi.fn(async () => false);
    const formatAlert = vi.fn((input: Parameters<RunSingleIncomingDepositJobCycleDeps["formatIncomingDepositRiskAlert"]>[0]) => ({
      text: input.addressPoisoningWarningActive ? "warning-active" : "ordinary",
      parseMode: "HTML" as const
    }));
    const send = vi.fn(async () => undefined);

    await runSingleIncomingDepositJobCycle({
      claimNextForensicCheckJob: async () => job(validProgressJson),
      completeForensicCheckJob: async () => true,
      markUserAlertSent: async () => true,
      markUserAlertFailed: async () => true,
      recordObservedTransactionRisk: async () => true,
      hasUndismissedAddressPoisoningCandidateForIncoming: lookup,
      sendUserAlert: send,
      formatIncomingDepositRiskAlert: formatAlert,
      buildReport: async () => report()
    });

    expect(lookup).toHaveBeenCalledTimes(1);
    expect(formatAlert).toHaveBeenCalledWith(expect.objectContaining({ addressPoisoningWarningActive: false }));
    expect(send).not.toHaveBeenCalled();
  });

  it("logs a poisoning lookup failure and still persists the unchanged Incoming payload", async () => {
    const lookup = vi.fn(async () => {
      throw new Error("poisoning store unavailable");
    });
    const formatAlert = vi.fn((input: Parameters<RunSingleIncomingDepositJobCycleDeps["formatIncomingDepositRiskAlert"]>[0]) => ({
      text: input.addressPoisoningWarningActive ? "warning-active" : "ordinary",
      parseMode: "HTML" as const
    }));
    const send = vi.fn(async () => undefined);
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const handled = await runSingleIncomingDepositJobCycle({
      claimNextForensicCheckJob: async () => job(validProgressJson),
      completeForensicCheckJob: async () => true,
      markUserAlertSent: async () => true,
      markUserAlertFailed: async () => true,
      recordObservedTransactionRisk: async () => true,
      hasUndismissedAddressPoisoningCandidateForIncoming: lookup,
      sendUserAlert: send,
      formatIncomingDepositRiskAlert: formatAlert,
      buildReport: async () => report(),
      logger
    });

    expect(handled).toBe(true);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith("incoming_deposit_poisoning_warning_lookup_failed", {
      job_id: "job-incoming-1",
      deposit_tx_hash: depositTxHash,
      watched_wallet_id: watchedWalletId,
      error: "poisoning store unavailable"
    });
    expect(formatAlert).toHaveBeenCalledWith(expect.objectContaining({ addressPoisoningWarningActive: false }));
    expect(send).not.toHaveBeenCalled();
  });

  it("does not persist a generic observed risk for a completed no-final incoming result", async () => {
    const complete = vi.fn(async (_input: Parameters<RunSingleIncomingDepositJobCycleDeps["completeForensicCheckJob"]>[0]) => true);
    const send = vi.fn(async () => undefined);
    const recordObservedTransactionRisk = vi.fn(async () => true);

    const handled = await runSingleIncomingDepositJobCycle({
      claimNextForensicCheckJob: async () => job(validProgressJson),
      completeForensicCheckJob: complete,
      markUserAlertSent: async () => true,
      markUserAlertFailed: async () => true,
      recordObservedTransactionRisk,
      sendUserAlert: send,
      formatIncomingDepositRiskAlert: () => ({
        text: "<b>Incoming USDT</b>",
        parseMode: "HTML"
      }),
      buildReport: async () => report({
        decision: "NO_FINAL_DECISION",
        scoreValid: false,
        scoreBlockedReason: "insufficient_coverage",
        technicalStatus: "provider_cap_unresolved",
        depositRiskScore: null,
        observedContextScore: 45,
        riskBand: null
      })
    });

    expect(handled).toBe(true);
    expect(recordObservedTransactionRisk).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      status: "completed",
      resultJson: expect.objectContaining({
        scoringPolicyVersion: SCORING_SIGNAL_MATRIX_POLICY_VERSION,
        decision: "NO_FINAL_DECISION",
        depositRiskScore: null
      })
    }));
    const completion = complete.mock.calls[0]?.[0];
    if (!completion) throw new Error("expected incoming no-final completion");
    expect(buildScoringAuditRow({
      ...job(validProgressJson),
      status: "completed",
      resultJson: completion.resultJson,
      completedAt: new Date("2026-05-29T14:03:00.000Z")
    }).policyVersion).toBe(SCORING_SIGNAL_MATRIX_POLICY_VERSION);
  });

  it("[AC-39][REQ-25][LLM-BOUNDARY] persists the sanitized active projection without mutating the raw input report", async () => {
    const legacyReport = report({
      decision: "DECLINE",
      scoreValid: true,
      scoreBlockedReason: null,
      technicalStatus: "completed",
      depositRiskScore: 95,
      observedContextScore: 95,
      riskBand: "CRITICAL",
      fastSenderRisk: {
        subjectAddress: incomingSenderAddress,
        level: "CRITICAL",
        score: 93,
        reasons: [{
          code: "legacy_llm_sender_risk",
          message: "Legacy LLM sender-risk prose.",
          scoreImpact: 93,
          evidenceRef: "legacy-llm-sender-evidence"
        }]
      },
      originPaths: [{
        verdict: "DECLINE",
        score: 94,
        sourcePolicy: "hard_decline",
        stoppedReason: "unknown_contract_reached",
        pathAddresses: ["TLegacyOrigin111111111111111111111111"],
        txHashes: ["legacy-llm-origin-evidence"],
        steps: [],
        amountCoverageRatio: 1,
        amountContinuity: "strong",
        proximityHops: 1,
        reasons: ["Legacy LLM origin-path prose."]
      }],
      originCoverage: 1,
      fundingCoverage: {
        depositFundingCoverageRatio: 1,
        cleanSourceCoverageRatio: 1,
        exactContinuityCoverageRatio: 1
      },
      provenanceConfidence: 99,
      dataQuality: "high",
      senderRole: "legacy_llm_sender_role",
      walletExposureProfile: {
        windowStart: "2026-05-01T00:00:00.000Z",
        windowEnd: "2026-05-29T14:01:00.000Z",
        transferEventsScanned: 95,
        incomingVolumeRaw: "95000000",
        outgoingVolumeRaw: "0",
        htxHuobiIncomingShare: 0,
        cleanCexIncomingShare: 0,
        bridgeRouterDexVolumeShare: 0,
        unknownContractVolumeShare: 1,
        unknownSourceShare: 0,
        inOutVelocityScore: 0,
        scoreContribution: 95,
        reasons: ["Legacy LLM wallet-exposure prose."],
        warnings: ["legacy-llm-wallet-evidence"]
      },
      hardBadEvidence: [{
        kind: "llm_contract_suspicion",
        score: 95,
        message: "Legacy LLM hard evidence prose.",
        evidenceIds: ["legacy-llm-evidence"]
      }],
      contractVerdicts: [{
        source: "llm",
        cacheMatch: null,
        reusedFromContractAddress: null,
        providerLabel: "legacy-provider",
        model: "legacy-model",
        contractAddress: "TLegacyContract11111111111111111111111",
        caseFileHash: "legacy-case",
        cacheId: null,
        verdict: "unknown_suspicious",
        confidence: 0.99,
        contractRiskScore: 95,
        decisionRecommendation: "DECLINE",
        reasons: ["Legacy LLM verdict prose."],
        citedEvidenceIds: ["legacy-llm-evidence"],
        falsePositiveNotes: []
      }, {
        source: "cache",
        cacheMatch: "address",
        reusedFromContractAddress: null,
        providerLabel: "legacy-cached-provider",
        model: "legacy-cached-model",
        contractAddress: "TLegacyCachedContract111111111111111111",
        caseFileHash: "legacy-cached-case",
        cacheId: "legacy-cached-verdict",
        verdict: "drainer_like",
        confidence: 0.98,
        contractRiskScore: 94,
        decisionRecommendation: "DECLINE",
        reasons: ["Legacy cached LLM verdict prose."],
        citedEvidenceIds: ["legacy-cached-llm-evidence"],
        falsePositiveNotes: []
      }],
      reasons: ["Legacy LLM decision prose."],
      warnings: ["Legacy LLM warning prose."]
    });
    const rawSnapshot = structuredClone(legacyReport);
    const recordObservedTransactionRisk = vi.fn(async () => true);
    const completeForensicCheckJob = vi.fn(async (
      _input: Parameters<RunSingleIncomingDepositJobCycleDeps["completeForensicCheckJob"]>[0]
    ) => true);
    const formatIncomingDepositRiskAlert = vi.fn((input: Parameters<RunSingleIncomingDepositJobCycleDeps["formatIncomingDepositRiskAlert"]>[0]) => ({
      text: JSON.stringify(input.report),
      parseMode: "HTML" as const
    }));
    const sendUserAlert = vi.fn(async () => undefined);

    await runSingleIncomingDepositJobCycle({
      claimNextForensicCheckJob: async () => job(validProgressJson),
      completeForensicCheckJob,
      markUserAlertSent: async () => true,
      markUserAlertFailed: async () => true,
      recordObservedTransactionRisk,
      sendUserAlert,
      formatIncomingDepositRiskAlert,
      buildReport: async () => legacyReport
    });

    expect(recordObservedTransactionRisk).not.toHaveBeenCalled();
    expect(formatIncomingDepositRiskAlert).toHaveBeenCalledWith(expect.objectContaining({
      report: expect.objectContaining({
        decision: "NO_FINAL_DECISION",
        scoreValid: false,
        depositRiskScore: null,
        observedContextScore: 0,
        riskBand: null,
        fastSenderRisk: null,
        originPaths: [],
        originCoverage: 0,
        fundingCoverage: {
          depositFundingCoverageRatio: 0,
          cleanSourceCoverageRatio: 0,
          exactContinuityCoverageRatio: 0
        },
        corridorSummary: null,
        provenanceConfidence: 0,
        dataQuality: "low",
        senderRole: null,
        targetedHistoryCoverage: undefined,
        coverageV2: undefined,
        sourcePolicyEvidence: [],
        hardBadEvidence: [],
        contractVerdicts: [],
        contractDrivenReceiverProfile: undefined,
        contractDrivenTransferProfiles: undefined,
        contractDrivenSubjectAddress: undefined,
        freshBundleExposure: undefined,
        walletExposureProfile: undefined,
        sourceBundleExposure: undefined,
        subjectExposureProfile: undefined,
        unifiedRiskSummary: undefined,
        reasons: [],
        warnings: []
      })
    }));
    expect(sendUserAlert).not.toHaveBeenCalled();
    expect(completeForensicCheckJob).toHaveBeenCalledWith(expect.objectContaining({
      resultJson: expect.objectContaining({
        scoringPolicyVersion: SCORING_SIGNAL_MATRIX_POLICY_VERSION,
        decision: "NO_FINAL_DECISION",
        scoreValid: false,
        depositRiskScore: null,
        observedContextScore: 0,
        riskBand: null,
        fastSenderRisk: null,
        originPaths: [],
        originCoverage: 0,
        fundingCoverage: {
          depositFundingCoverageRatio: 0,
          cleanSourceCoverageRatio: 0,
          exactContinuityCoverageRatio: 0
        },
        corridorSummary: null,
        provenanceConfidence: 0,
        dataQuality: "low",
        senderRole: null,
        sourcePolicyEvidence: [],
        hardBadEvidence: [],
        contractVerdicts: [],
        walletExposureProfile: undefined,
        unifiedRiskSummary: undefined,
        reasons: [],
        warnings: []
      })
    }));
    const persistedResult = completeForensicCheckJob.mock.calls[0]?.[0].resultJson;
    const formattedResult = formatIncomingDepositRiskAlert.mock.calls[0]?.[0].report;
    for (const projectedResult of [formattedResult, persistedResult]) {
      expect(JSON.stringify(projectedResult)).not.toContain("Legacy LLM");
      expect(JSON.stringify(projectedResult)).not.toContain("legacy-llm-");
      expect(JSON.stringify(projectedResult)).not.toContain("TLegacyOrigin");
      expect(JSON.stringify(projectedResult)).not.toContain("legacy_llm_sender_role");
    }
    expect(legacyReport).toEqual(rawSnapshot);

    const legacyPolicyOnlyReport = report({
      decision: "DECLINE",
      scoreValid: true,
      depositRiskScore: 82,
      observedContextScore: 82,
      riskBand: "HIGH",
      sourcePolicyEvidence: [{
        kind: "unknown_contract",
        aggregateShare: 1,
        effectiveShare: 1,
        pathCount: 1,
        score: 82,
        riskBand: "HIGH",
        proofLevel: "llm_assisted_suspicion",
        canBeDampened: false,
        reasons: ["Legacy LLM source-policy prose."],
        warnings: [],
        evidenceIds: ["legacy-policy-evidence"]
      }]
    });
    const legacyPolicyOnlySnapshot = structuredClone(legacyPolicyOnlyReport);
    formatIncomingDepositRiskAlert.mockClear();
    const riskOnlySend = vi.fn(async () => undefined);
    const riskOnlyRecord = vi.fn(async () => true);
    await runSingleIncomingDepositJobCycle({
      claimNextForensicCheckJob: async () => job({ ...validProgressJson, alertMode: "risk_only" }),
      completeForensicCheckJob: async () => true,
      markUserAlertSent: async () => true,
      markUserAlertFailed: async () => true,
      recordObservedTransactionRisk: riskOnlyRecord,
      sendUserAlert: riskOnlySend,
      formatIncomingDepositRiskAlert,
      buildReport: async () => legacyPolicyOnlyReport
    });

    expect(riskOnlyRecord).not.toHaveBeenCalled();
    expect(formatIncomingDepositRiskAlert).not.toHaveBeenCalled();
    expect(riskOnlySend).not.toHaveBeenCalled();
    expect(legacyReport).toEqual(rawSnapshot);
    expect(legacyPolicyOnlyReport).toEqual(legacyPolicyOnlySnapshot);
  });

  it("does not fail an incoming job when wallet intelligence indexing fails", async () => {
    const completeForensicCheckJob = vi.fn(async () => true);
    const indexWalletIntelligenceJob = vi.fn(async () => {
      throw new Error("wallet intelligence unavailable");
    });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const handled = await runSingleIncomingDepositJobCycle({
      claimNextForensicCheckJob: async () => job(validProgressJson),
      completeForensicCheckJob,
      updateForensicCheckJobProgress: vi.fn(async () => true),
      markUserAlertSent: vi.fn(async () => true),
      markUserAlertFailed: vi.fn(async () => true),
      recordObservedTransactionRisk: vi.fn(async () => true),
      sendUserAlert: vi.fn(async () => undefined),
      formatIncomingDepositRiskAlert: () => ({ text: "ok", parseMode: "HTML" }),
      buildReport: async () => report(),
      indexWalletIntelligenceJob,
      logger
    });

    expect(handled).toBe(true);
    expect(completeForensicCheckJob).toHaveBeenCalledTimes(1);
    expect(indexWalletIntelligenceJob).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith("wallet_intelligence_index_failed", expect.objectContaining({
      error: "wallet intelligence unavailable"
    }));
  });

  it("does not index wallet intelligence when incoming job completion is not applied", async () => {
    const completeForensicCheckJob = vi.fn(async (
      _input: Parameters<RunSingleIncomingDepositJobCycleDeps["completeForensicCheckJob"]>[0]
    ) => false);
    const indexWalletIntelligenceJob = vi.fn(async () => undefined);
    const sendUserAlert = vi.fn(async () => undefined);
    const markUserAlertSent = vi.fn(async () => true);

    const handled = await runSingleIncomingDepositJobCycle({
      claimNextForensicCheckJob: async () => job(validProgressJson),
      completeForensicCheckJob,
      updateForensicCheckJobProgress: vi.fn(async () => true),
      markUserAlertSent,
      markUserAlertFailed: vi.fn(async () => true),
      recordObservedTransactionRisk: vi.fn(async () => true),
      sendUserAlert,
      formatIncomingDepositRiskAlert: () => ({ text: "ok", parseMode: "HTML" }),
      buildReport: async () => report(),
      indexWalletIntelligenceJob
    });

    expect(handled).toBe(true);
    expect(completeForensicCheckJob).toHaveBeenCalledTimes(1);
    expect(completeForensicCheckJob.mock.calls[0]?.[0].progressJson).toEqual(expect.objectContaining({
      telegramDelivery: expect.objectContaining({
        payload: expect.objectContaining({ chatId: "42", text: "ok" }),
        state: expect.objectContaining({ status: "pending", attemptCount: 0 }),
        claim: null
      })
    }));
    expect(indexWalletIntelligenceJob).not.toHaveBeenCalled();
    expect(sendUserAlert).not.toHaveBeenCalled();
    expect(markUserAlertSent).not.toHaveBeenCalled();
  });

  it("leaves incoming deposit job waiting when targeted indexing is queued", async () => {
    const complete = vi.fn(async () => true);
    const markFailed = vi.fn(async () => true);
    const send = vi.fn(async () => undefined);

    const handled = await runSingleIncomingDepositJobCycle({
      claimNextForensicCheckJob: async () => job({
        ...validProgressJson,
        jobPhase: "waiting_for_targeted_index"
      }),
      completeForensicCheckJob: complete,
      updateForensicCheckJobProgress: async () => true,
      markUserAlertSent: async () => true,
      markUserAlertFailed: markFailed,
      recordObservedTransactionRisk: async () => true,
      sendUserAlert: send,
      formatIncomingDepositRiskAlert: () => ({
        text: "<b>Incoming USDT</b>",
        parseMode: "HTML" as const
      }),
      buildReport: async () => {
        throw new TargetedHistoryWaitingForIndex();
      }
    });

    expect(handled).toBe(true);
    expect(complete).not.toHaveBeenCalled();
    expect(markFailed).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("aborts once and skips failure handling when targeted waiting loses the claim", async () => {
    const abort = vi.spyOn(AbortController.prototype, "abort");
    const complete = vi.fn(async () => true);
    const markFailed = vi.fn(async () => true);
    try {
      const handled = await runSingleIncomingDepositJobCycle({
        claimNextForensicCheckJob: async () => job(validProgressJson),
        completeForensicCheckJob: complete,
        updateForensicCheckJobProgress: async () => true,
        markUserAlertSent: async () => true,
        markUserAlertFailed: markFailed,
        recordObservedTransactionRisk: async () => true,
        formatIncomingDepositRiskAlert: () => ({ text: "unused", parseMode: "HTML" }),
        buildReport: async () => {
          throw new Error("lost_forensic_job_claim");
        }
      });

      expect(handled).toBe(true);
      expect(abort).toHaveBeenCalledTimes(1);
      expect(complete).not.toHaveBeenCalled();
      expect(markFailed).not.toHaveBeenCalled();
    } finally {
      abort.mockRestore();
    }
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
      sender: incomingSenderAddress,
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

  it("logs total incoming deposit duration from cycle start", async () => {
    let currentMs = Date.parse("2026-05-29T14:02:05.000Z");
    const infoLogs: Array<{ event: string; fields: Record<string, unknown> | undefined }> = [];

    await runSingleIncomingDepositJobCycle({
      claimNextForensicCheckJob: async () => job(validProgressJson),
      completeForensicCheckJob: async () => {
        currentMs += 1_000;
        return true;
      },
      markUserAlertSent: async () => true,
      markUserAlertFailed: async () => true,
      recordObservedTransactionRisk: async () => {
        currentMs += 2_000;
        return true;
      },
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
      now: () => new Date(currentMs),
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
        total_run_ms: 34_000,
        top_stages: expect.arrayContaining([
          expect.objectContaining({ name: "build_report", durationMs: 31_000 })
        ])
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

  it("treats a false progress CAS as claim loss even when the warning logger throws", async () => {
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
    expect(complete).not.toHaveBeenCalled();
    expect(updateForensicCheckJobProgress).toHaveBeenCalled();
    expect(warnCallCount).toBe(0);
  });

  it("persists incoming deposit phases before trace, risk recording, and completion", async () => {
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
      "completing",
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
    const lookup = vi.fn(async () => true);

    const handled = await runSingleIncomingDepositJobCycle({
      claimNextForensicCheckJob: async () => job({ ...validProgressJson, alertMode: "risk_only" }),
      completeForensicCheckJob: complete,
      markUserAlertSent: markSent,
      markUserAlertFailed: async () => true,
      recordObservedTransactionRisk: recordRisk,
      hasUndismissedAddressPoisoningCandidateForIncoming: lookup,
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
    expect(lookup).not.toHaveBeenCalled();
    expect(markSent).toHaveBeenCalledWith({ txHash: depositTxHash, watchedWalletId });
  });

  it("does not mark a suppressed alert sent when completion CAS is lost", async () => {
    const markSent = vi.fn(async () => true);

    await runSingleIncomingDepositJobCycle({
      claimNextForensicCheckJob: async () => job({ ...validProgressJson, alertMode: "risk_only" }),
      completeForensicCheckJob: async () => false,
      markUserAlertSent: markSent,
      markUserAlertFailed: vi.fn(async () => true),
      recordObservedTransactionRisk: vi.fn(async () => true),
      formatIncomingDepositRiskAlert: vi.fn(() => ({ text: "must-not-format", parseMode: "HTML" as const })),
      buildReport: async () => report({ decision: "ACCEPTABLE" })
    });

    expect(markSent).not.toHaveBeenCalled();
  });

  it("fails jobs missing required progress_json fields without building or sending", async () => {
    const complete = vi.fn(async () => true);
    const buildReport = vi.fn(async () => report());
    const send = vi.fn(async () => undefined);
    const markSent = vi.fn(async () => true);
    const buildJobFailurePayload = vi.fn(async () => failurePayload("missing-fields"));

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
      buildJobFailurePayload,
      formatIncomingDepositRiskAlert: () => ({
        text: "<b>Incoming USDT</b>",
        parseMode: "HTML"
      }),
      buildReport
    });

    expect(handled).toBe(true);
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed",
      lastError: expect.stringContaining("missing required progress_json fields"),
      progressJson: expect.objectContaining({
        telegramDelivery: expect.objectContaining({
          payload: expect.objectContaining({ chatId: "42", text: "missing-fields" }),
          effect: null,
          state: expect.objectContaining({ status: "pending", attemptCount: 0 })
        })
      })
    }));
    expect(buildJobFailurePayload).toHaveBeenCalledTimes(1);
    expect(buildReport).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(markSent).not.toHaveBeenCalled();
  });

  it("rejects incoming jobs whose Telegram identity does not match the durable job chat", async () => {
    const complete = vi.fn(async (
      _input: Parameters<RunSingleIncomingDepositJobCycleDeps["completeForensicCheckJob"]>[0]
    ) => true);
    const buildReport = vi.fn(async () => report());
    const formatAlert = vi.fn(() => ({ text: "must-not-format", parseMode: "HTML" as const }));
    const buildJobFailurePayload = vi.fn(async () => failurePayload("identity-mismatch"));

    const handled = await runSingleIncomingDepositJobCycle({
      claimNextForensicCheckJob: async () => job({ ...validProgressJson, telegramUserId: "different-chat" }),
      completeForensicCheckJob: complete,
      markUserAlertSent: vi.fn(async () => true),
      markUserAlertFailed: vi.fn(async () => true),
      recordObservedTransactionRisk: vi.fn(async () => true),
      buildJobFailurePayload,
      formatIncomingDepositRiskAlert: formatAlert,
      buildReport
    });

    expect(handled).toBe(true);
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed",
      lastError: expect.stringContaining("missing required progress_json fields"),
      progressJson: expect.objectContaining({
        telegramDelivery: expect.objectContaining({
          payload: expect.objectContaining({ chatId: "42", text: "identity-mismatch" }),
          effect: null,
          state: expect.objectContaining({ status: "pending", attemptCount: 0 })
        })
      })
    }));
    expect(buildJobFailurePayload).toHaveBeenCalledTimes(1);
    expect(buildReport).not.toHaveBeenCalled();
    expect(formatAlert).not.toHaveBeenCalled();
  });

  it("rejects progress sender mismatch before analyzing or formatting another address", async () => {
    const senderB = "TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM";
    const events: string[] = [];
    const complete = vi.fn(async (
      _input: Parameters<RunSingleIncomingDepositJobCycleDeps["completeForensicCheckJob"]>[0]
    ) => {
      events.push("complete");
      return true;
    });
    const markFailed = vi.fn(async () => {
      events.push("markFailed");
      return true;
    });
    const buildReport = vi.fn(async () => report());
    const formatAlert = vi.fn(() => ({ text: `must-not-format-${senderB}`, parseMode: "HTML" as const }));
    const recordRisk = vi.fn(async () => true);
    const send = vi.fn(async () => undefined);
    const buildJobFailurePayload = vi.fn(async () => failurePayload("sender-mismatch"));

    await runSingleIncomingDepositJobCycle({
      claimNextForensicCheckJob: async () => job({ ...validProgressJson, sender: senderB }),
      completeForensicCheckJob: complete,
      markUserAlertSent: vi.fn(async () => true),
      markUserAlertFailed: markFailed,
      recordObservedTransactionRisk: recordRisk,
      sendUserAlert: send,
      buildJobFailurePayload,
      formatIncomingDepositRiskAlert: formatAlert,
      buildReport
    });

    expect(buildJobFailurePayload).toHaveBeenCalledWith(
      expect.objectContaining({ subjectAddress: incomingSenderAddress }),
      expect.stringContaining("missing required progress_json fields")
    );
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed",
      progressJson: expect.objectContaining({
        telegramDelivery: expect.objectContaining({
          payload: expect.objectContaining({ chatId: "42", text: "sender-mismatch" }),
          effect: null,
          state: expect.objectContaining({ status: "pending", attemptCount: 0 })
        })
      })
    }));
    expect(JSON.stringify(complete.mock.calls[0]?.[0].progressJson.telegramDelivery)).not.toContain(senderB);
    expect(buildReport).not.toHaveBeenCalled();
    expect(formatAlert).not.toHaveBeenCalled();
    expect(recordRisk).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(events).toEqual(["complete", "markFailed"]);
  });

  it("marks the observed alert failed and fails the job when report building throws", async () => {
    const events: string[] = [];
    const complete = vi.fn(async () => {
      events.push("complete");
      return true;
    });
    const markFailed = vi.fn(async () => {
      events.push("markFailed");
      return true;
    });

    const handled = await runSingleIncomingDepositJobCycle({
      claimNextForensicCheckJob: async () => job(validProgressJson),
      completeForensicCheckJob: complete,
      markUserAlertSent: async () => true,
      markUserAlertFailed: markFailed,
      recordObservedTransactionRisk: async () => true,
      sendUserAlert: async () => undefined,
      buildJobFailurePayload: async () => failurePayload("report-failed"),
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
      lastError: "risk builder unavailable",
      progressJson: expect.objectContaining({
        telegramDelivery: expect.objectContaining({
          payload: expect.objectContaining({ chatId: "42", text: "report-failed" }),
          effect: null
        })
      })
    }));
    expect(events).toEqual(["complete", "markFailed"]);
  });

  it("persists a pending failure envelope when incoming alert formatting throws", async () => {
    const complete = vi.fn(async () => true);
    const markFailed = vi.fn(async () => true);

    await runSingleIncomingDepositJobCycle({
      claimNextForensicCheckJob: async () => job(validProgressJson),
      completeForensicCheckJob: complete,
      markUserAlertSent: vi.fn(async () => true),
      markUserAlertFailed: markFailed,
      recordObservedTransactionRisk: vi.fn(async () => true),
      buildJobFailurePayload: async () => failurePayload("formatter-failed"),
      formatIncomingDepositRiskAlert: () => {
        throw new Error("incoming formatter unavailable");
      },
      buildReport: async () => report()
    });

    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed",
      lastError: "incoming formatter unavailable",
      progressJson: expect.objectContaining({
        telegramDelivery: expect.objectContaining({
          payload: expect.objectContaining({ chatId: "42", text: "formatter-failed" }),
          effect: null
        })
      })
    }));
    expect(markFailed).toHaveBeenCalledTimes(1);
  });

  it("leaves the observed alert untouched when failure completion CAS is lost", async () => {
    const abort = vi.spyOn(AbortController.prototype, "abort");
    const complete = vi.fn(async () => false);
    const markFailed = vi.fn(async () => true);
    const send = vi.fn(async () => undefined);

    try {
      await expect(runSingleIncomingDepositJobCycle({
        claimNextForensicCheckJob: async () => job(validProgressJson),
        completeForensicCheckJob: complete,
        markUserAlertSent: vi.fn(async () => true),
        markUserAlertFailed: markFailed,
        recordObservedTransactionRisk: vi.fn(async () => true),
        sendUserAlert: send,
        buildJobFailurePayload: async () => failurePayload("cas-lost"),
        formatIncomingDepositRiskAlert: () => ({ text: "unused", parseMode: "HTML" as const }),
        buildReport: async () => {
          throw new Error("risk builder unavailable");
        }
      })).rejects.toThrow("lost_forensic_job_claim");
      expect(abort).toHaveBeenCalledTimes(1);
    } finally {
      abort.mockRestore();
    }

    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed",
      progressJson: expect.objectContaining({
        telegramDelivery: expect.objectContaining({ payload: expect.objectContaining({ text: "cas-lost" }) })
      })
    }));
    expect(markFailed).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("does not let a legacy Telegram sender failure change the completed job or risk", async () => {
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
    expect(markFailed).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      status: "completed",
      lastError: null,
      resultJson: expect.objectContaining({ depositRiskScore: 32 }),
      progressJson: expect.objectContaining({
        telegramDelivery: expect.objectContaining({
          state: expect.objectContaining({ status: "pending", attemptCount: 0 })
        })
      })
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
            { name: "build_report", durationMs: 20 }
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
            { name: "build_report", durationMs: 11 }
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

  it("stops completion when a later timing progress CAS loses the claim", async () => {
    let updateCallCount = 0;
    const warnLogs: Array<{ event: string; fields: Record<string, unknown> | undefined }> = [];
    const complete = vi.fn(async () => true);

    await runSingleIncomingDepositJobCycle({
      claimNextForensicCheckJob: async () => job(validProgressJson),
      updateForensicCheckJobProgress: async () => {
        updateCallCount += 1;
        return updateCallCount < 4;
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

    expect(complete).not.toHaveBeenCalled();
    expect(warnLogs).toEqual([]);
  });
});

describe("buildIncomingDepositReport", () => {
  it("preserves distinct indexed events and deduplicates a repeated indexed identity in incoming runtime seeds", async () => {
    vi.resetModules();
    const seedTransferRuns: Array<Array<{ evidenceId?: string }>> = [];
    const captureError = new Error("captured incoming runtime seeds");
    const runWhereIsMoneyCheck = vi.fn(async (_deps: unknown, input: { seedTransfers?: Array<{ evidenceId?: string }> }) => {
      seedTransferRuns.push(input.seedTransfers ?? []);
      throw captureError;
    });
    vi.doMock("../../src/check/whereIsMoneyCheck", async (importOriginal) => ({
      ...await importOriginal<typeof import("../../src/check/whereIsMoneyCheck")>(),
      runWhereIsMoneyCheck
    }));

    try {
      const { buildIncomingDepositReport: buildReportWithMock } = await import("../../src/forensics/incomingDepositJob");
      const first = indexedTransfer({
        txHash: "same-tuple-incoming-runtime",
        eventIndex: 1,
        fromAddress: "TFunderSameTuple111111111111111111111",
        toAddress: validProgressJson.sender,
        amountRaw: "1000000"
      });
      const second = { ...first, eventIndex: 2 };
      const amountRaw = "2000000";
      const liveOverlap = liveTransfer({
        transaction_id: first.txHash,
        from_address: first.fromAddress,
        to_address: first.toAddress,
        quant: first.amountRaw,
        block_ts: first.blockTimestamp.getTime()
      });
      let indexedRows = [first, { ...first }];
      const run = () => buildReportWithMock({
        deps: {
          listIndexedUsdtTransfersForAddress: async (address) => address === validProgressJson.sender
            ? indexedRows
            : [],
          listRelatedTrc20Transfers: async () => [liveOverlap],
          getLabelsForAddress: async () => [],
          getClassificationForAddress: async () => null,
          getContractIntelligenceProfile: async () => null,
          getTransaction: async () => ({}),
          getUsdtRestrictionStatus: async (address) => ({ ...stablecoinProfile(address), balanceRaw: amountRaw })
        },
        job: job({ ...validProgressJson, amountRaw, amount: "2" }),
        depositTxHash,
        watchedWallet: validProgressJson.watchedWallet,
        sender: validProgressJson.sender,
        amountRaw,
        timestamp: new Date(validProgressJson.timestamp)
      });

      await expect(run()).rejects.toThrow(captureError.message);
      indexedRows = [first, second, { ...first }];
      await expect(run()).rejects.toThrow(captureError.message);
      expect(seedTransferRuns[0]).toHaveLength(1);
      expect(seedTransferRuns[1]).toHaveLength(2);
      expect(new Set(seedTransferRuns[1].map((item) => item.evidenceId)).size).toBe(2);
    } finally {
      vi.doUnmock("../../src/check/whereIsMoneyCheck");
      vi.resetModules();
    }
  });

  it("aborts a delayed shared raw enrichment on claim loss without full, next-candidate, completion, or delivery", async () => {
    let updates = 0;
    let observedAborted = false;
    const complete = vi.fn(async () => true);
    const record = vi.fn(async () => true);
    const firstHash = depositTxHash;
    const nextHash = "e".repeat(64);
    const rawCalls: string[] = [];
    const fullCalls: string[] = [];
    const saved = new Map<string, TronTransactionProviderEvidenceV1>();
    let releaseRaw!: (payload: unknown) => void;
    let signalRawStarted!: () => void;
    const rawStarted = new Promise<void>((resolve) => { signalRawStarted = resolve; });
    const delayedRaw = new Promise<unknown>((resolve) => { releaseRaw = resolve; });
    const movement = (txHash: string): ForensicRouteEdge => ({
      id: `edge:${txHash}`,
      txHash,
      transferId: `transfer:${txHash}`,
      eventIndex: 0,
      provider: "tronscan",
      providerRowOrdinalInTx: 0,
      fromAddress: validProgressJson.sender,
      toAddress: validProgressJson.watchedWallet,
      amountRaw: "1000000",
      timestamp: new Date(validProgressJson.timestamp),
      method: "transfer",
      edgeType: "normal_transfer",
      callerAddress: validProgressJson.sender,
      contractAddress: TRON_USDT_CONTRACT_ADDRESS,
      contractRet: "SUCCESS",
      finalResult: "SUCCESS",
      confirmed: true,
      reverted: false,
      economicRole: "principal"
    });
    const firstMovement = movement(firstHash);
    const nextMovement = movement(nextHash);
    const wordAddress = TronWeb.address.toHex(validProgressJson.watchedWallet).slice(2).padStart(64, "0").toLowerCase();
    const rawPayload = {
      txID: firstHash,
      raw_data: {
        contract: [{
          type: "TriggerSmartContract",
          parameter: {
            type_url: "type.googleapis.com/protocol.TriggerSmartContract",
            value: {
              owner_address: TronWeb.address.toHex(validProgressJson.sender),
              contract_address: TronWeb.address.toHex(TRON_USDT_CONTRACT_ADDRESS),
              data: `a9059cbb${wordAddress}${(1_000_000).toString(16).padStart(64, "0")}`
            }
          }
        }]
      },
      ret: [{ contractRet: "SUCCESS" }]
    };
    const enricher = createSelectiveTransactionEnricher({
      getSavedEvidence: async (identity) => saved.get(transactionProviderEvidenceId(identity)) ?? null,
      saveProviderEvidence: async (evidence) => {
        const id = transactionProviderEvidenceId(evidence);
        saved.set(id, evidence);
        return { id };
      },
      saveDecisionEvidence: async (evidence) => ({ id: `decision:${evidence.txHash}` }),
      getRawTransaction: async (txHash) => {
        rawCalls.push(txHash);
        if (txHash === firstHash) {
          signalRawStarted();
          return delayedRaw;
        }
        return null;
      },
      getFullTransactionInfo: async (txHash) => {
        fullCalls.push(txHash);
        return null;
      },
      now: () => new Date("2026-07-27T00:00:30.000Z"),
      maxConcurrentSubmissions: 1
    });

    const handledPromise = runSingleIncomingDepositJobCycle({
      claimNextForensicCheckJob: async () => job(validProgressJson),
      updateForensicCheckJobProgress: async () => {
        updates += 1;
        return updates === 1;
      },
      transactionEnrichmentHeartbeatIntervalMs: 1,
      completeForensicCheckJob: complete,
      markUserAlertSent: async () => true,
      markUserAlertFailed: async () => true,
      recordObservedTransactionRisk: record,
      formatIncomingDepositRiskAlert: () => ({ text: "unused", parseMode: "HTML" }),
      buildReport: async ({ abortSignal, runWithTransactionEnrichmentHeartbeat }) => {
        const claimedRun = runWithTransactionEnrichmentHeartbeat((onCandidateResolved) => enricher.enrich({
          mode: "subject",
          routeEdges: [firstMovement, nextMovement],
          movements: [firstMovement, nextMovement]
        }, { signal: abortSignal, onCandidateResolved }));
        const secondClaimedRun = runWithTransactionEnrichmentHeartbeat((onCandidateResolved) => enricher.enrich({
          mode: "subject",
          routeEdges: [firstMovement],
          movements: [firstMovement]
        }, { signal: abortSignal, onCandidateResolved }));
        const otherWaiter = enricher.enrich({
          mode: "subject",
          routeEdges: [firstMovement],
          movements: [firstMovement]
        });
        await rawStarted;
        if (!abortSignal?.aborted) {
          await new Promise<void>((resolve) => abortSignal?.addEventListener("abort", () => resolve(), { once: true }));
        }
        observedAborted = abortSignal?.aborted === true;
        releaseRaw(rawPayload);
        await expect(claimedRun).rejects.toThrow("selective_transaction_enrichment_aborted");
        await expect(secondClaimedRun).rejects.toThrow("selective_transaction_enrichment_aborted");
        await expect(otherWaiter).resolves.toMatchObject({ coverageStatus: "complete" });
        throw new Error("lost_forensic_job_claim");
      }
    });
    const handled = await handledPromise;

    expect(handled).toBe(true);
    expect(observedAborted).toBe(true);
    expect(updates).toBe(2);
    expect(rawCalls).toEqual([firstHash]);
    expect(fullCalls).toEqual([]);
    expect(saved.size).toBeGreaterThan(0);
    expect(complete).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it("keeps delayed nested Where enrichment inside the Incoming job heartbeat coordinator", async () => {
    vi.resetModules();
    const nestedHash = "9".repeat(64);
    const nestedEdge: ForensicRouteEdge = {
      id: `nested:${nestedHash}`,
      txHash: nestedHash,
      fromAddress: "TFunder111111111111111111111111111111",
      toAddress: validProgressJson.sender,
      amountRaw: "1000000",
      timestamp: new Date(validProgressJson.timestamp),
      method: "transfer",
      edgeType: "normal_transfer"
    };
    let releaseNestedRaw!: () => void;
    let signalNestedStarted!: () => void;
    const nestedStarted = new Promise<void>((resolve) => { signalNestedStarted = resolve; });
    const nestedRaw = new Promise<void>((resolve) => { releaseNestedRaw = resolve; });
    let sharedRaw: Promise<void> | null = null;
    let rawCalls = 0;
    let fullCalls = 0;
    let independentWaiter: Promise<unknown> | null = null;
    const complete = vi.fn(async () => true);
    const record = vi.fn(async () => true);
    const enrichmentResult = {
      policyVersion: "selective-transaction-enrichment-v1" as const,
      coverageStatus: "complete" as const,
      technicalStatus: "proven" as const,
      candidateCount: 1,
      hardCandidateCount: 0,
      rawProviderRequests: 1,
      fullProviderRequests: 0,
      savedEvidenceHits: 0,
      inFlightHits: 0,
      schedulerAwaitMs: 0,
      evidenceIds: ["nested:raw"],
      decisions: [],
      adverseGate: "complete" as const,
      inferredStopAllowed: true,
      continueTraversal: false
    };
    const selectiveTransactionEnricher = {
      async enrich(
        enrichmentInput: SelectiveTransactionEnrichmentInput,
        options: { signal?: AbortSignal; onCandidateResolved?: (input: { completed: number; total: number }) => Promise<void> | void } = {}
      ) {
        const nested = enrichmentInput.routeEdges.some((edge) => edge.txHash === nestedHash);
        if (!nested) {
          await options.onCandidateResolved?.({ completed: 1, total: 1 });
          return { ...enrichmentResult, rawProviderRequests: 0, evidenceIds: [] };
        }
        if (!sharedRaw) {
          rawCalls += 1;
          signalNestedStarted();
          sharedRaw = nestedRaw;
        }
        await sharedRaw;
        if (options.signal?.aborted) throw new Error("selective_transaction_enrichment_aborted");
        await options.onCandidateResolved?.({ completed: 1, total: 1 });
        return enrichmentResult;
      },
      async getFullTransactionInfo() {
        fullCalls += 1;
        return null;
      }
    };
    const runWhereIsMoneyCheck = vi.fn(async (deps: any, input: any) => {
      independentWaiter = deps.selectiveTransactionEnricher.enrich({
        mode: "subject",
        routeEdges: [nestedEdge],
        movements: [nestedEdge]
      });
      return input.runWithTransactionEnrichmentHeartbeat((onCandidateResolved: any) =>
        deps.selectiveTransactionEnricher.enrich({
          mode: "subject",
          routeEdges: [nestedEdge],
          movements: [nestedEdge]
        }, { signal: input.abortSignal, onCandidateResolved })
      );
    });
    vi.doMock("../../src/check/whereIsMoneyCheck", async (importOriginal) => ({
      ...await importOriginal<typeof import("../../src/check/whereIsMoneyCheck")>(),
      runWhereIsMoneyCheck
    }));

    try {
      const { buildIncomingDepositReport: buildReportWithMock } = await import("../../src/forensics/incomingDepositJob");
      let nestedPending = false;
      let activeCas = 0;
      let maxActiveCas = 0;
      const handledPromise = runSingleIncomingDepositJobCycle({
        claimNextForensicCheckJob: async () => job(validProgressJson),
        updateForensicCheckJobProgress: async () => {
          activeCas += 1;
          maxActiveCas = Math.max(maxActiveCas, activeCas);
          try {
            await new Promise<void>((resolve) => setTimeout(resolve, 2));
            return !nestedPending;
          } finally {
            activeCas -= 1;
          }
        },
        transactionEnrichmentHeartbeatIntervalMs: 1,
        completeForensicCheckJob: complete,
        markUserAlertSent: async () => true,
        markUserAlertFailed: async () => true,
        recordObservedTransactionRisk: record,
        formatIncomingDepositRiskAlert: () => ({ text: "unused", parseMode: "HTML" }),
        buildReport: (runnerInput) => buildReportWithMock({
          ...runnerInput,
          deps: {
            listIndexedUsdtTransfersForAddress: async () => [],
            listRelatedTrc20Transfers: async () => [],
            getLabelsForAddress: async () => [],
            getClassificationForAddress: async () => null,
            getContractIntelligenceProfile: async () => null,
            getTransaction: async () => ({}),
            selectiveTransactionEnricher,
            getUsdtRestrictionStatus: async (address) => ({ ...stablecoinProfile(address), balanceRaw: "1000000" })
          }
        })
      });

      await nestedStarted;
      nestedPending = true;
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      releaseNestedRaw();
      expect(await handledPromise).toBe(true);
      await expect(independentWaiter).resolves.toMatchObject({ evidenceIds: ["nested:raw"] });
      expect(runWhereIsMoneyCheck).toHaveBeenCalled();
      expect(rawCalls).toBe(1);
      expect(fullCalls).toBe(1); // outer deposit persisted-reader only; nested aborted before its reader
      expect(maxActiveCas).toBe(1);
      expect(complete).not.toHaveBeenCalled();
      expect(record).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock("../../src/check/whereIsMoneyCheck");
      vi.resetModules();
    }
  });

  it("[REQ-31][AC-13][INCOMING] persists transaction-seed coverage with the checked deposit context", async () => {
    const receiverDeepReport = {
      subjectAddress: validProgressJson.watchedWallet,
      firstHopBlacklistFacts: [{
        counterpartyAddress: validProgressJson.sender,
        direction: "inbound",
        evidenceKind: "usdt_blacklist",
        evidenceAuthority: "official_contract",
        statusAtCheck: "active",
        temporalRelation: "unknown",
        effectiveAt: null,
        effectiveTxHash: null,
        checkedAt: "2026-05-29T14:02:00.000Z",
        principalAmountRaw: validProgressJson.amountRaw,
        principalTxCount: 1,
        directionalPrincipalShare: 1,
        shareSemantics: "exact",
        transferTxHashes: [depositTxHash],
        beforeEffectiveAmountRaw: "0",
        beforeEffectiveTxCount: 0,
        activeAmountRaw: "0",
        activeTxCount: 0,
        unknownTimingAmountRaw: validProgressJson.amountRaw,
        unknownTimingTxCount: 1,
        directTransferCoverage: "complete",
        timelineCoverage: "partial",
        timelineEvents: []
      }],
      directCounterpartyInteractionProfiles: [{
        subjectAddress: validProgressJson.watchedWallet,
        direction: "inbound",
        counterpartyAddress: validProgressJson.sender,
        volumeRaw: validProgressJson.amountRaw,
        volumeRatio: 1,
        txCount: 1,
        firstSeen: validProgressJson.timestamp,
        lastSeen: validProgressJson.timestamp,
        txHashes: [depositTxHash],
        transfers: [{
          txHash: depositTxHash,
          fromAddress: validProgressJson.sender,
          toAddress: validProgressJson.watchedWallet,
          amountRaw: validProgressJson.amountRaw,
          timestamp: validProgressJson.timestamp,
          method: "transfer",
          edgeType: "normal_transfer"
        }],
        serviceCategory: null,
        identity: null,
        snapshot: {
          address: validProgressJson.sender,
          riskScore: 95,
          riskLevel: "CRITICAL",
          source: "stablecoin_blacklist",
          evidenceClass: "exact_labeled_counterparty",
          reasons: [],
          partialNotes: []
        },
        interactionWeight: 1,
        scoreContribution: 90,
        evidenceClass: "exact_labeled_counterparty",
        skippedReason: null
      }]
    } as unknown as DeepAddressForensicReport;

    const { result } = await runCompleteIncomingTargetedMaterializationScenario({
      hopRows: incomingMaterializationRows,
      receiverDeepReport
    });

    expect(result).toMatchObject({
      decision: "DECLINE",
      scoreValid: true,
      depositRiskScore: 90
    });
    expect(result.coverageV2).toMatchObject({
      version: "forensic-coverage-v2",
      scope: "transaction_seed",
      availableInboundTxCount: 1,
      selectedInboundTxCount: 1,
      excludedInboundTxCount: 0,
      selectedAmountRaw: validProgressJson.amountRaw
    });
  });

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

  it("merges outer selective evidence, exact assertions, heartbeat, and incomplete coverage into the report", async () => {
    const fundingHash = "f".repeat(64);
    const assertion = {
      chain: "tron",
      address: validProgressJson.sender,
      status: "active",
      evidenceJson: { approvalTxHash: depositTxHash }
    };
    const listActiveRouteAssertions = vi.fn(async () => [assertion]);
    const persistProgress = vi.fn(async (patch) => patch);
    const enrich = vi.fn(async (enrichmentInput: SelectiveTransactionEnrichmentInput, options?: {
      onCandidateResolved?: (input: { completed: number; total: number }) => Promise<void> | void;
    }) => {
      await options?.onCandidateResolved?.({ completed: 1, total: 1 });
      const outer = enrichmentInput.routeEdges.some((routeEdge) => routeEdge.txHash === depositTxHash);
      return {
        policyVersion: "selective-transaction-enrichment-v1" as const,
        coverageStatus: outer ? "coverage_incomplete" as const : "complete" as const,
        technicalStatus: outer ? "technical_unknown" as const : "proven" as const,
        candidateCount: 1,
        hardCandidateCount: outer ? 1 : 0,
        rawProviderRequests: 0,
        fullProviderRequests: 0,
        savedEvidenceHits: 1,
        inFlightHits: 0,
        schedulerAwaitMs: 0,
        evidenceIds: outer ? ["outer-only-evidence"] : [],
        decisions: [],
        adverseGate: outer ? "incomplete" as const : "complete" as const,
        inferredStopAllowed: !outer,
        continueTraversal: outer
      };
    });

    const result = await buildIncomingDepositReport({
      deps: {
        listIndexedUsdtTransfersForAddress: async (address) => address === validProgressJson.sender
          ? [indexedTransfer({
              txHash: fundingHash,
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
        selectiveTransactionEnricher: { enrich, getFullTransactionInfo: async () => null },
        listActiveRouteAssertions,
        listIndexedMovementsByHashes: async () => [],
        getUsdtRestrictionStatus: async (address) => ({ ...stablecoinProfile(address), balanceRaw: "1000000" })
      },
      job: job(validProgressJson),
      depositTxHash,
      watchedWallet: validProgressJson.watchedWallet,
      sender: validProgressJson.sender,
      amountRaw: validProgressJson.amountRaw,
      timestamp: new Date(validProgressJson.timestamp),
      persistProgress
    });

    expect(result.transactionInfoEnrichment).toMatchObject({
      coverageStatus: "coverage_incomplete",
      technicalStatus: "technical_unknown",
      evidenceIds: expect.arrayContaining(["outer-only-evidence"])
    });
    expect(result.warnings).toContain(
      "Transaction evidence incomplete: at least one incoming-deposit outer route candidate lacks final evidence."
    );
    expect(listActiveRouteAssertions).toHaveBeenCalledWith(expect.objectContaining({
      addresses: expect.arrayContaining([validProgressJson.sender, validProgressJson.watchedWallet]),
      txHashes: [depositTxHash]
    }));
    expect(enrich.mock.calls.some((call) => (call[0] as { assertions?: unknown[] }).assertions?.[0] === assertion)).toBe(true);
    expect(persistProgress).toHaveBeenCalledWith(expect.objectContaining({ jobHeartbeatAt: expect.any(String) }));
  });

  it("composes fast sender risk and deterministic contract analysis without fresh LLM output", async () => {
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
        getUsdtRestrictionStatus: async () => stablecoinState
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
    expect(result.contractVerdicts).toEqual([]);
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
    expect(enrichContractClassification).toHaveBeenCalledWith(contract);
    expect(getTransaction).toHaveBeenCalledWith("contract-in-1");
  });

  it("target-indexes where-is-money hops and reuses cached edges for funding bundles", async () => {
    const hub = "THub11111111111111111111111111111111";
    const cleanCex = "TBinance1111111111111111111111111111";
    const fundingTimestamp = new Date("2026-05-29T13:30:00.000Z");
    const upstreamTimestamp = new Date("2026-05-29T13:20:00.000Z");
    const indexedCalls: Array<{ address: string; minTimestamp?: Date; maxTimestamp?: Date }> = [];
    const liveCalls: Array<{ address: string; minTimestamp?: number; endTimestamp?: number }> = [];
    const ensureAddressUsdtHistory = vi.fn(async (input: Parameters<NonNullable<IncomingDepositRuntimeDeps["ensureAddressUsdtHistory"]>>[0]) => ({
      ...queuedTargetedIndexState({
        address: input.address,
        targetTimestamp: input.targetTimestamp ?? null,
        requestedByJobId: input.requestedByJobId ?? null,
        queuedReason: input.queuedReason
      }),
      status: "complete" as const,
      statusReason: "complete_provider_windowed" as const,
      completedAt: new Date("2026-07-02T00:00:00.000Z")
    }));
    const listIndexed = vi.fn(async (address: string, options: {
      minTimestamp?: Date;
      maxTimestamp?: Date;
      limit: number;
      orderBy: "newest";
      direction: "both";
    }) => {
      indexedCalls.push({ address, minTimestamp: options.minTimestamp, maxTimestamp: options.maxTimestamp });
      if (address === validProgressJson.sender) {
        return [indexedTransfer({
          txHash: "hub-funded-sender",
          fromAddress: hub,
          toAddress: validProgressJson.sender,
          amountRaw: validProgressJson.amountRaw,
          blockTimestamp: fundingTimestamp
        })];
      }
      if (address === hub) {
        return [indexedTransfer({
          txHash: "cex-funded-hub",
          fromAddress: cleanCex,
          toAddress: hub,
          amountRaw: validProgressJson.amountRaw,
          blockTimestamp: upstreamTimestamp
        })];
      }
      return [];
    });
    const listLive = vi.fn(async (address: string, options: {
      start: number;
      limit: number;
      minTimestamp?: number;
      endTimestamp?: number;
    }) => {
      liveCalls.push({ address, minTimestamp: options.minTimestamp, endTimestamp: options.endTimestamp });
      return [];
    });

    const result = await buildIncomingDepositReport({
      deps: {
        listIndexedUsdtTransfersForAddress: listIndexed,
        listRelatedTrc20Transfers: listLive,
        ensureAddressUsdtHistory,
        getLabelsForAddress: async () => [],
        getClassificationForAddress: async (address): Promise<ServiceClassification | null> =>
          address === cleanCex
            ? { category: "cex", identity: "Binance", confidence: "high", evidence: ["tag:binance"], isBoundary: true }
            : null,
        getContractIntelligenceProfile: async () => null,
        getTransaction: async () => ({}),
        getUsdtRestrictionStatus: async (address) => ({ ...stablecoinProfile(address), balanceRaw: "1000000" })
      },
      job: job(validProgressJson),
      depositTxHash,
      watchedWallet: validProgressJson.watchedWallet,
      sender: validProgressJson.sender,
      amountRaw: validProgressJson.amountRaw,
      timestamp: new Date(validProgressJson.timestamp)
    });

    expect(result.originPaths.some((path) => path.txHashes.includes("cex-funded-hub"))).toBe(true);
    expect(ensureAddressUsdtHistory).toHaveBeenCalledTimes(1);
    expect(ensureAddressUsdtHistory).toHaveBeenCalledWith(expect.objectContaining({
      jobId: "job-incoming-1",
      claimStartedAt: job(validProgressJson).startedAt,
      address: hub,
      coverageMode: "targeted",
      targetTimestamp: fundingTimestamp,
      stopAtTimestamp: fundingTimestamp,
      requestedByJobId: "job-incoming-1",
      queuedReason: "incoming_deposit_hop"
    }));
    const hubWindowIndexedReads = indexedCalls.filter((call) =>
      call.address === hub &&
      call.minTimestamp?.getTime() === job(validProgressJson).windowStart.getTime() &&
      call.maxTimestamp?.getTime() === fundingTimestamp.getTime()
    );
    const hubWindowLiveReads = liveCalls.filter((call) =>
      call.address === hub &&
      call.minTimestamp === job(validProgressJson).windowStart.getTime() &&
      call.endTimestamp === fundingTimestamp.getTime()
    );
    expect(hubWindowIndexedReads).toHaveLength(1);
    expect(hubWindowLiveReads).toHaveLength(1);
  });

  it("target-indexes the direct sender hop even when the sender window is already cached", async () => {
    const ensureAddressUsdtHistory = vi.fn(async (input: Parameters<NonNullable<IncomingDepositRuntimeDeps["ensureAddressUsdtHistory"]>>[0]) => ({
      ...queuedTargetedIndexState({
        address: input.address,
        targetTimestamp: input.targetTimestamp ?? null,
        requestedByJobId: input.requestedByJobId ?? null,
        queuedReason: input.queuedReason
      }),
      status: "complete" as const,
      statusReason: "complete_provider_windowed" as const,
      completedAt: new Date("2026-07-02T00:00:00.000Z")
    }));
    const senderReads: Array<{ address: string; minTimestamp?: Date; maxTimestamp?: Date }> = [];

    await buildIncomingDepositReport({
      deps: {
        listIndexedUsdtTransfersForAddress: async (address, options) => {
          senderReads.push({ address, minTimestamp: options.minTimestamp, maxTimestamp: options.maxTimestamp });
          return [];
        },
        listRelatedTrc20Transfers: async () => [],
        ensureAddressUsdtHistory,
        getLabelsForAddress: async () => [],
        getClassificationForAddress: async () => null,
        getContractIntelligenceProfile: async () => null,
        getTransaction: async () => ({}),
        getUsdtRestrictionStatus: async (address) => ({ ...stablecoinProfile(address), balanceRaw: "1000000" })
      },
      job: job(validProgressJson),
      depositTxHash,
      watchedWallet: validProgressJson.watchedWallet,
      sender: validProgressJson.sender,
      amountRaw: validProgressJson.amountRaw,
      timestamp: new Date(validProgressJson.timestamp)
    });

    expect(ensureAddressUsdtHistory).toHaveBeenCalledWith(expect.objectContaining({
      address: validProgressJson.sender,
      coverageMode: "targeted",
      targetTimestamp: new Date(validProgressJson.timestamp),
      stopAtTimestamp: new Date(validProgressJson.timestamp),
      requestedByJobId: "job-incoming-1",
      queuedReason: "incoming_deposit_hop"
    }));
    const senderWindowReads = senderReads.filter((read) =>
      read.address === validProgressJson.sender &&
      read.minTimestamp?.getTime() === job(validProgressJson).windowStart.getTime() &&
      read.maxTimestamp?.getTime() === new Date(validProgressJson.timestamp).getTime()
    );
    expect(senderWindowReads).toHaveLength(2);
  });

  it("materializes row 201 from a complete targeted index", async () => {
    const scenario = await runCompleteIncomingTargetedMaterializationScenario({
      hopRows: incomingMaterializationRows
    });

    expect(scenario.indexOffsets).toEqual([0, 200]);
    expect(scenario.indexDirections).toEqual(["both", "both"]);
    expect(scenario.targetedLiveProviderCalls).toBe(0);
    expect(scenario.queueAddressUsdtHistory).not.toHaveBeenCalled();
    expect(scenario.releaseForensicCheckJobToWaiting).not.toHaveBeenCalled();
    expect(scenario.result.originPaths.flatMap((path) => path.pathAddresses)).toContain(scenario.upstreamSource);
    expect(scenario.result).toMatchObject({
      decision: "NO_FINAL_DECISION",
      scoreValid: false,
      depositRiskScore: null,
      unifiedRiskSummary: { decisionBasis: "technical_stop" }
    });
    expect(scenario.result.targetedHistoryCoverage).toMatchObject({
      pagesFetched: 2,
      transfersFetched: 201,
      partialHopCount: 0
    });
  });

  it("maps a complete-index read failure to local_data_error", async () => {
    const scenario = await runCompleteIncomingTargetedMaterializationScenario({
      hopRows: [],
      throwOnHopRead: true
    });

    expect(scenario.indexOffsets).toEqual([0]);
    expect(scenario.indexDirections).toEqual(["both"]);
    expect(scenario.targetedLiveProviderCalls).toBe(0);
    expect(scenario.queueAddressUsdtHistory).not.toHaveBeenCalled();
    expect(scenario.releaseForensicCheckJobToWaiting).not.toHaveBeenCalled();
    expect(scenario.result).toMatchObject({
      decision: "NO_FINAL_DECISION",
      scoreValid: false,
      scoreBlockedReason: "local_index_read_failed",
      technicalStatus: "local_data_error"
    });
    expect(scenario.result.targetedHistoryCoverage).toMatchObject({
      firstBlockingReason: "local_index_read_failed",
      firstBlockingTechnicalStatus: "local_data_error"
    });
    expect(scenario.result.warnings.join(" ").toLowerCase()).not.toContain("provider cap");
  });

  it("keeps exact sender blacklist proof decisive through local targeted coverage failure", async () => {
    const scenario = await runCompleteIncomingTargetedMaterializationScenario({
      hopRows: [],
      throwOnHopRead: true,
      senderBlacklisted: true
    });

    expect(scenario.result).toMatchObject({
      decision: "DECLINE",
      depositRiskScore: 95,
      scoreValid: true,
      scoreBlockedReason: null,
      technicalStatus: "completed",
      unifiedRiskSummary: {
        finalDecision: "DECLINE",
        decisionBasis: "exact_hard_proof",
        coverage: {
          overall: "partial",
          invalidModes: ["incoming_deposit_provenance"],
          caveats: expect.arrayContaining(["local_index_read_failed:local_data_error"])
        }
      }
    });
    expect(scenario.result.targetedHistoryCoverage).toMatchObject({
      firstBlockingReason: "local_index_read_failed",
      firstBlockingTechnicalStatus: "local_data_error"
    });
  });

  it("reuses a covering-only local read failure for same-window enrichment", async () => {
    const scenario = await runCompleteIncomingTargetedMaterializationScenario({
      hopRows: [],
      throwOnHopRead: true,
      amountRaw: "600000000000",
      coveringStateOnly: true
    });

    expect(scenario.getAddressUsdtIndexState).toHaveBeenCalled();
    expect(scenario.getCoveringAddressUsdtIndexState).toHaveBeenCalled();
    expect(scenario.indexOffsets).toEqual([0]);
    expect(scenario.ensureAddressUsdtHistory).not.toHaveBeenCalledWith(expect.objectContaining({
      address: scenario.hub,
      targetTimestamp: scenario.fundingTimestamp
    }));
    expect(scenario.targetedLiveProviderCalls).toBe(0);
    expect(scenario.queueAddressUsdtHistory).not.toHaveBeenCalled();
    expect(scenario.releaseForensicCheckJobToWaiting).not.toHaveBeenCalled();
    expect(scenario.result).toMatchObject({
      decision: "NO_FINAL_DECISION",
      scoreValid: false,
      scoreBlockedReason: "local_index_read_failed",
      technicalStatus: "local_data_error"
    });
    expect(scenario.result.targetedHistoryCoverage).toMatchObject({
      firstBlockingReason: "local_index_read_failed",
      firstBlockingTechnicalStatus: "local_data_error"
    });
  });

  it("maps a complete-index local row limit before provider acquisition status", async () => {
    const scenario = await runCompleteIncomingTargetedMaterializationScenario({
      hopRows: incomingMaterializationRows,
      localIndexMaterializationMaxRows: 200
    });

    expect(scenario.indexOffsets).toEqual([0, 200]);
    expect(scenario.indexDirections).toEqual(["both", "both"]);
    expect(scenario.targetedLiveProviderCalls).toBe(0);
    expect(scenario.queueAddressUsdtHistory).not.toHaveBeenCalled();
    expect(scenario.result).toMatchObject({
      decision: "NO_FINAL_DECISION",
      scoreValid: false,
      scoreBlockedReason: "local_budget_limited",
      technicalStatus: "local_budget_limited"
    });
    expect(scenario.result.targetedHistoryCoverage).toMatchObject({
      transfersFetched: 200,
      firstBlockingReason: "local_budget_limited",
      firstBlockingTechnicalStatus: "local_budget_limited"
    });
    expect(scenario.result.warnings.join(" ").toLowerCase()).not.toContain("provider cap");
  });

  it("queues incoming candidate windows before broad targeted fallback", async () => {
    const senderFundingTx = "incoming-sender-funding";
    const upstreamFundingTx = "incoming-upstream-funding";
    const funder = "TIncomingFunder111111111111111111111";
    const upstream = "TIncomingUpstream1111111111111111111";
    const senderFundingAt = new Date("2026-05-29T13:30:00.000Z");
    const upstreamFundingAt = new Date("2026-05-29T13:25:00.000Z");
    const queueAddressUsdtHistory = vi.fn(async (input: Parameters<NonNullable<IncomingDepositRuntimeDeps["queueAddressUsdtHistory"]>>[0]) => ({
      ...queuedTargetedIndexState({
        address: input.address,
        targetTimestamp: input.targetTimestamp ?? null,
        requestedByJobId: input.requestedByJobId ?? null,
        queuedReason: input.queuedReason
      }),
      requestKind: input.requestKind ?? "broad_targeted",
      windowStartTimestamp: input.windowStartTimestamp ?? null,
      windowEndTimestamp: input.windowEndTimestamp ?? null,
      relatedHopTxHash: input.relatedHopTxHash ?? null,
      candidateTxHash: input.candidateTxHash ?? null
    }));
    const releaseForensicCheckJobToWaiting = vi.fn(async () => true);
    const upsertForensicJobWait = vi.fn(async () => undefined);

    await expect(buildIncomingDepositReport({
      deps: {
        listIndexedUsdtTransfersForAddress: async (address) => {
          if (address === validProgressJson.sender) {
            return [indexedTransfer({
              txHash: senderFundingTx,
              fromAddress: funder,
              toAddress: validProgressJson.sender,
              amountRaw: validProgressJson.amountRaw,
              blockTimestamp: senderFundingAt
            })];
          }
          if (address === funder) {
            return [
              indexedTransfer({
                txHash: senderFundingTx,
                fromAddress: funder,
                toAddress: validProgressJson.sender,
                amountRaw: validProgressJson.amountRaw,
                blockTimestamp: senderFundingAt
              }),
              indexedTransfer({
                txHash: upstreamFundingTx,
                fromAddress: upstream,
                toAddress: funder,
                amountRaw: validProgressJson.amountRaw,
                blockTimestamp: upstreamFundingAt
              })
            ];
          }
          return [];
        },
        listRelatedTrc20Transfers: async () => [],
        getLabelsForAddress: async () => [],
        getClassificationForAddress: async () => null,
        getContractIntelligenceProfile: async () => null,
        getTransaction: async () => ({}),
        getUsdtRestrictionStatus: async (address) => ({ ...stablecoinProfile(address), balanceRaw: "1000000" }),
        getAddressUsdtIndexState: async () => null,
        queueAddressUsdtHistory,
        releaseForensicCheckJobToWaiting,
        upsertForensicJobWait
      },
      job: job(validProgressJson),
      depositTxHash,
      watchedWallet: validProgressJson.watchedWallet,
      sender: validProgressJson.sender,
      amountRaw: validProgressJson.amountRaw,
      timestamp: new Date(validProgressJson.timestamp),
      persistProgress: async (patch) => patch
    })).rejects.toBeInstanceOf(TargetedHistoryWaitingForIndex);

    expect(queueAddressUsdtHistory).toHaveBeenCalledWith(expect.objectContaining({
      address: funder,
      requestKind: "candidate_window",
      queuedReason: "incoming_candidate_window",
      targetTimestamp: senderFundingAt,
      windowStartTimestamp: upstreamFundingAt,
      windowEndTimestamp: senderFundingAt,
      relatedHopTxHash: senderFundingTx,
      candidateTxHash: upstreamFundingTx,
      requestedByJobId: "job-incoming-1"
    }));
    expect(upsertForensicJobWait).toHaveBeenCalledWith(expect.objectContaining({
      jobId: "job-incoming-1",
      address: funder,
      requestKind: "candidate_window",
      requiredFor: "incoming_hop"
    }));
    expect(releaseForensicCheckJobToWaiting).toHaveBeenCalledOnce();
  });

  it("keeps incoming hop history incomplete when targeted ensure fails", async () => {
    const result = await buildIncomingDepositReport({
      deps: {
        listIndexedUsdtTransfersForAddress: async () => [],
        listRelatedTrc20Transfers: async () => [],
        ensureAddressUsdtHistory: async () => {
          throw new Error("429");
        },
        getLabelsForAddress: async () => [],
        getClassificationForAddress: async () => null,
        getContractIntelligenceProfile: async () => null,
        getTransaction: async () => ({}),
        getUsdtRestrictionStatus: async (address) => ({ ...stablecoinProfile(address), balanceRaw: "1000000" })
      },
      job: job(validProgressJson),
      depositTxHash,
      watchedWallet: validProgressJson.watchedWallet,
      sender: validProgressJson.sender,
      amountRaw: validProgressJson.amountRaw,
      timestamp: new Date(validProgressJson.timestamp)
    });

    expect(result.originPaths.some((path) => path.stoppedReason === "incoming_history_not_fetched")).toBe(true);
    expect(result.originPaths
      .filter((path) => path.stoppedReason === "incoming_history_not_fetched")
      .every((path) => path.verdict === "REVIEW")).toBe(true);
    expect(result.decision).toBe("NO_FINAL_DECISION");
    expect(result.scoreValid).toBe(false);
    expect(result.depositRiskScore).toBeNull();
    expect(result.riskBand).toBeNull();
    expect(result.observedContextScore).toEqual(expect.any(Number));
    expect(result.scoreBlockedReason).toBe("rate_limited_after_retries");
    expect(result.technicalStatus).toBe("provider_limited");
    expect(result.targetedHistoryCoverage).toMatchObject({
      selectedDepositTxHash: depositTxHash,
      partialHopCount: expect.any(Number),
      firstBlockingReason: "rate_limited_after_retries",
      firstBlockingTechnicalStatus: "provider_limited"
    });
    expect(result.warnings).toEqual(expect.arrayContaining([
      "Technical status: provider_limited.",
      expect.stringContaining("targeted history ensure failed")
    ]));
  });

  it("marks incoming score invalid with budget_limited when mandatory targeted history exhausts budget", async () => {
    const result = await buildIncomingDepositReport({
      deps: {
        listIndexedUsdtTransfersForAddress: async () => [],
        listRelatedTrc20Transfers: async () => [],
        ensureAddressUsdtHistory: async (input) => ({
          ...queuedTargetedIndexState({
            address: input.address,
            targetTimestamp: input.targetTimestamp ?? null,
            requestedByJobId: input.requestedByJobId ?? null,
            queuedReason: input.queuedReason
          }),
          status: "partial" as const,
          statusReason: "partial_budget_exhausted" as const,
          fetchedPageCount: 4,
          fetchedTransferCount: 100,
          budgetExhausted: true
        }),
        getLabelsForAddress: async () => [],
        getClassificationForAddress: async () => null,
        getContractIntelligenceProfile: async () => null,
        getTransaction: async () => ({}),
        getUsdtRestrictionStatus: async (address) => ({ ...stablecoinProfile(address), balanceRaw: "1000000" })
      },
      job: job(validProgressJson),
      depositTxHash,
      watchedWallet: validProgressJson.watchedWallet,
      sender: validProgressJson.sender,
      amountRaw: validProgressJson.amountRaw,
      timestamp: new Date(validProgressJson.timestamp)
    });

    expect(result.originPaths.some((path) => path.stoppedReason === "incoming_history_not_fetched")).toBe(true);
    expect(result.decision).toBe("NO_FINAL_DECISION");
    expect(result.scoreValid).toBe(false);
    expect(result.scoreBlockedReason).toBe("partial_budget_exhausted");
    expect(result.technicalStatus).toBe("budget_limited");
    expect(result.targetedHistoryCoverage).toMatchObject({
      selectedDepositTxHash: depositTxHash,
      firstBlockingReason: "partial_budget_exhausted",
      firstBlockingTechnicalStatus: "budget_limited"
    });
    expect(result.warnings).toEqual(expect.arrayContaining([
      "Technical status: budget_limited.",
      expect.stringContaining("targeted history ensure incomplete")
    ]));
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
    expect(result).toMatchObject({
      decision: "NO_FINAL_DECISION",
      scoreValid: false,
      depositRiskScore: null,
      unifiedRiskSummary: { decisionBasis: "technical_stop" }
    });
  });

  it("traces an incoming deposit through non-boundary contract accounts to Binance", async () => {
    const gasFreeHop1 = "TGasFreeHop111111111111111111111111";
    const unknownHop2 = "TUnknownHop222222222222222222222222";
    const gasFreeHop3 = "TGasFreeHop333333333333333333333333";
    const binance = "TBinanceBoundary11111111111111111111";
    const transfersByAddress = new Map<string, IndexedTronUsdtTransfer[]>([
      [validProgressJson.sender, [indexedTransfer({
        txHash: "gasfree-1-sender",
        fromAddress: gasFreeHop1,
        toAddress: validProgressJson.sender,
        amountRaw: validProgressJson.amountRaw,
        blockTimestamp: new Date("2026-05-29T13:50:00.000Z")
      })]],
      [gasFreeHop1, [indexedTransfer({
        txHash: "unknown-gasfree-1",
        fromAddress: unknownHop2,
        toAddress: gasFreeHop1,
        amountRaw: validProgressJson.amountRaw,
        blockTimestamp: new Date("2026-05-29T13:40:00.000Z")
      })]],
      [unknownHop2, [indexedTransfer({
        txHash: "gasfree-3-unknown",
        fromAddress: gasFreeHop3,
        toAddress: unknownHop2,
        amountRaw: validProgressJson.amountRaw,
        blockTimestamp: new Date("2026-05-29T13:30:00.000Z")
      })]],
      [gasFreeHop3, [indexedTransfer({
        txHash: "binance-gasfree-3",
        fromAddress: binance,
        toAddress: gasFreeHop3,
        amountRaw: validProgressJson.amountRaw,
        blockTimestamp: new Date("2026-05-29T13:20:00.000Z")
      })]]
    ]);

    const result = await buildIncomingDepositReport({
      deps: {
        listIndexedUsdtTransfersForAddress: async (address) => transfersByAddress.get(address) ?? [],
        listRelatedTrc20Transfers: async (address) => (transfersByAddress.get(address) ?? []).map((transfer) => liveTransfer({
          transaction_id: transfer.txHash,
          from_address: transfer.fromAddress,
          to_address: transfer.toAddress,
          quant: transfer.amountRaw,
          block_ts: transfer.blockTimestamp.getTime()
        })),
        getLabelsForAddress: async () => [],
        getClassificationForAddress: async (address): Promise<ServiceClassification | null> => {
          if (address === binance) {
            return { category: "cex", identity: "Binance", confidence: "high", evidence: ["tag:binance"], isBoundary: true };
          }
          if (address === unknownHop2) {
            return { category: "unknown_contract", identity: "unknown", confidence: "high", evidence: ["test:traceable_contract"], isBoundary: false };
          }
          if (address === gasFreeHop1 || address === gasFreeHop3) {
            return { category: "service", identity: "GasFree Account", confidence: "high", evidence: ["test:traceable_contract"], isBoundary: false };
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
      expect.objectContaining({
        stoppedReason: "clean_cex_reached",
        pathAddresses: [
          binance,
          gasFreeHop3,
          unknownHop2,
          gasFreeHop1,
          validProgressJson.sender,
          validProgressJson.watchedWallet
        ]
      })
    ]));
    expect(result.originPaths.flatMap((path) => path.reasons).join(" ")).not.toContain("unlabeled_service_boundary");
  });

  it("keeps an exact GasFree principal deposit funding-first and reaches Binance", async () => {
    const principalTxHash = "tx-incoming-gasfree-principal";
    const binance = "TBinanceBoundary11111111111111111111";
    const getTransaction = vi.fn(async (txHash: string) =>
      txHash === principalTxHash ? gasFreeTransaction() : null
    );

    const result = await buildIncomingDepositReport({
      deps: {
        listIndexedUsdtTransfersForAddress: async (address) => address === gasFreeAccount
          ? [indexedTransfer({
              txHash: "tx-binance-gasfree-funding",
              fromAddress: binance,
              toAddress: gasFreeAccount,
              amountRaw: "100000000",
              blockTimestamp: new Date("2026-07-10T00:00:00.000Z")
            })]
          : [],
        listRelatedTrc20Transfers: async () => [],
        getLabelsForAddress: async () => [],
        getClassificationForAddress: async (address): Promise<ServiceClassification | null> => {
          if (address === binance) {
            return { category: "cex", identity: "Binance", confidence: "high", evidence: ["tag:binance"], isBoundary: true };
          }
          if (address === gasFreeAccount) {
            return { category: "unknown_contract", identity: "GasFree Account", confidence: "high", evidence: ["metadata:gasfree"], isBoundary: true };
          }
          return null;
        },
        getContractIntelligenceProfile: async () => null,
        getTransaction,
        getUsdtRestrictionStatus: async (address) => ({ ...stablecoinProfile(address), balanceRaw: "0" })
      },
      job: job(validProgressJson),
      depositTxHash: principalTxHash,
      watchedWallet: gasFreeReceiver,
      sender: gasFreeAccount,
      amountRaw: "97000000",
      timestamp: new Date("2026-07-10T00:05:00.000Z")
    });

    expect(result.fundingCoverage.depositFundingCoverageRatio).toBe(1);
    expect(result.originPaths[0]).toMatchObject({
      stoppedReason: "clean_cex_reached",
      pathAddresses: [binance, gasFreeAccount, gasFreeReceiver]
    });
    expect(result.originPaths[0]?.reasons.join(" ")).not.toContain("GasFree service-fee");
    expect(getTransaction.mock.calls.filter(([txHash]) => txHash === principalTxHash).length).toBeGreaterThan(0);
  });

  it("keeps an exact GasFree fee deposit transaction-seeded", async () => {
    const feeTxHash = "tx-incoming-gasfree-fee";
    const riskyPayer = "TRiskyPayer1111111111111111111111111";
    const getTransaction = vi.fn(async (txHash: string) =>
      txHash === feeTxHash ? gasFreeTransaction() : null
    );
    const listIndexedUsdtTransfersForAddress = vi.fn(async (address: string) => address === gasFreeAccount
      ? [indexedTransfer({
          txHash: "tx-risky-payer-funding",
          fromAddress: riskyPayer,
          toAddress: gasFreeAccount,
          amountRaw: "100000000",
          blockTimestamp: new Date("2026-07-10T00:00:00.000Z")
        })]
      : []
    );

    const result = await buildIncomingDepositReport({
      deps: {
        listIndexedUsdtTransfersForAddress,
        listRelatedTrc20Transfers: async () => [],
        getLabelsForAddress: async (address) => address === riskyPayer ? [{
          address,
          label: "reported_scam",
          source: "system",
          createdByTelegramId: null,
          createdAt: new Date("2026-07-10T00:00:00.000Z")
        }] : [],
        getClassificationForAddress: async (address): Promise<ServiceClassification | null> => address === gasFreeAccount
          ? { category: "unknown_contract", identity: "GasFree Account", confidence: "high", evidence: ["metadata:gasfree"], isBoundary: true }
          : null,
        getContractIntelligenceProfile: async () => null,
        getTransaction,
        getUsdtRestrictionStatus: async (address) => ({ ...stablecoinProfile(address), balanceRaw: "0" })
      },
      job: job(validProgressJson),
      depositTxHash: feeTxHash,
      watchedWallet: gasFreeTlnt,
      sender: gasFreeAccount,
      amountRaw: "3000000",
      timestamp: new Date("2026-07-10T00:05:00.000Z")
    });

    expect(result.fundingCoverage.depositFundingCoverageRatio).toBe(1);
    expect(result.originPaths[0]).toMatchObject({
      pathAddresses: [gasFreeAccount, gasFreeTlnt],
      txHashes: [feeTxHash]
    });
    expect(result.originPaths[0]?.pathAddresses).not.toContain(riskyPayer);
    expect(result.originPaths[0]?.reasons.join(" ")).toContain("GasFree service-fee");
    expect(result.originPaths[0]?.score).toBe(0);
    expect(result.freshBundleExposure).toBeUndefined();
    expect(result.sourceBundleExposure).toBeUndefined();
    expect(result.walletExposureProfile).toBeUndefined();
    expect(result.subjectExposureProfile).toBeUndefined();
    expect(result.depositRiskScore).toBeNull();
    expect(result.riskBand).toBeNull();
    expect(result.unifiedRiskSummary).toMatchObject({
      finalScore: null,
      backgroundScore: 0
    });
    expect(result.decision).toBe("NO_FINAL_DECISION");
    expect(result.hardBadEvidence).toEqual([]);
    expect([...result.reasons, ...result.warnings].join(" ")).not.toMatch(
      /observed unknown source|uncovered checked-deposit source share|sender wallet historical exposure/i
    );
    expect(listIndexedUsdtTransfersForAddress).not.toHaveBeenCalled();
    expect(getTransaction.mock.calls.filter(([txHash]) => txHash === feeTxHash).length).toBeGreaterThan(0);
  });

  it("keeps an exact hard sender label authoritative for a GasFree fee deposit", async () => {
    const feeTxHash = "tx-incoming-hard-labeled-gasfree-fee";
    const result = await buildIncomingDepositReport({
      deps: {
        listIndexedUsdtTransfersForAddress: async () => {
          throw new Error("fee-only sender history must not be fetched");
        },
        listRelatedTrc20Transfers: async () => {
          throw new Error("fee-only sender history must not be fetched");
        },
        getLabelsForAddress: async (address) => address === gasFreeAccount ? [{
          address,
          label: "reported_scam",
          source: "system",
          createdByTelegramId: null,
          createdAt: new Date("2026-07-10T00:00:00.000Z")
        }] : [],
        getClassificationForAddress: async (address): Promise<ServiceClassification | null> => address === gasFreeAccount
          ? { category: "unknown_contract", identity: "GasFree Account", confidence: "high", evidence: ["metadata:gasfree"], isBoundary: true }
          : null,
        getContractIntelligenceProfile: async () => null,
        getTransaction: async (txHash) => txHash === feeTxHash ? gasFreeTransaction() : null,
        getUsdtRestrictionStatus: async (address) => ({ ...stablecoinProfile(address), balanceRaw: "0" })
      },
      job: job(validProgressJson),
      depositTxHash: feeTxHash,
      watchedWallet: gasFreeTlnt,
      sender: gasFreeAccount,
      amountRaw: "3000000",
      timestamp: new Date("2026-07-10T00:05:00.000Z")
    });

    expect(result.originPaths[0]?.reasons.join(" ")).toContain("GasFree service-fee");
    expect(result.freshBundleExposure).toBeUndefined();
    expect(result.sourceBundleExposure).toBeUndefined();
    expect(result.walletExposureProfile).toBeUndefined();
    expect(result.subjectExposureProfile).toBeUndefined();
    expect(result.decision).toBe("DECLINE");
    expect(result.depositRiskScore).toBeGreaterThanOrEqual(85);
    expect(result.hardBadEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "scam_or_blacklist" })
    ]));
  });

  it("removes a raw exact GasFree fee before selecting the real incoming-deposit funder", async () => {
    const ordinaryDepositTxHash = "tx-service-revenue-out";
    const historicalFeeTxHash = "tx-raw-historical-gasfree-fee";
    const watchedWallet = "TWatchedServiceRevenue111111111111111";
    const binance = "TBinanceServiceRevenue111111111111111";
    const getTransaction = vi.fn(async (txHash: string) =>
      txHash === historicalFeeTxHash ? gasFreeTransaction() : null
    );

    const result = await buildIncomingDepositReport({
      deps: {
        listIndexedUsdtTransfersForAddress: async (address) => address === gasFreeTlnt
          ? [
              indexedTransfer({
                txHash: historicalFeeTxHash,
                fromAddress: gasFreeAccount,
                toAddress: gasFreeTlnt,
                amountRaw: "3000000",
                blockTimestamp: new Date("2026-07-10T00:05:00.000Z")
              }),
              indexedTransfer({
                txHash: "tx-real-service-revenue-funder",
                fromAddress: binance,
                toAddress: gasFreeTlnt,
                amountRaw: "3000000",
                blockTimestamp: new Date("2026-07-10T00:00:00.000Z")
              })
            ]
          : [],
        listRelatedTrc20Transfers: async () => [],
        getLabelsForAddress: async () => [],
        getClassificationForAddress: async (address): Promise<ServiceClassification | null> => address === binance
          ? { category: "cex", identity: "Binance", confidence: "high", evidence: ["tag:binance"], isBoundary: true }
          : null,
        getContractIntelligenceProfile: async () => null,
        getTransaction,
        getUsdtRestrictionStatus: async (address) => ({ ...stablecoinProfile(address), balanceRaw: "0" })
      },
      job: job(validProgressJson),
      depositTxHash: ordinaryDepositTxHash,
      watchedWallet,
      sender: gasFreeTlnt,
      amountRaw: "3000000",
      timestamp: new Date("2026-07-10T00:10:00.000Z")
    });

    expect(result.originPaths[0]).toMatchObject({
      stoppedReason: "clean_cex_reached",
      pathAddresses: [binance, gasFreeTlnt, watchedWallet]
    });
    expect(result.originPaths[0]?.txHashes).not.toContain(historicalFeeTxHash);
    expect(getTransaction.mock.calls.filter(([txHash]) => txHash === historicalFeeTxHash).length).toBeGreaterThan(0);
  });

  it("removes a raw exact GasFree fee from large corridor funding bundles", async () => {
    const amountRaw = "500000000000";
    const sender = "TLargeCorridorSender11111111111111111";
    const watchedWallet = "TLargeCorridorWatched111111111111111";
    const binance = "TBinanceLargeCorridor111111111111111";
    const corridorTxHash = "tx-large-corridor-sender";
    const feeTxHash = "tx-large-corridor-gasfree-fee";
    const depositHash = "tx-large-corridor-deposit";
    const targetTransfer = indexedTransfer({
      txHash: corridorTxHash,
      fromAddress: gasFreeTlnt,
      toAddress: sender,
      amountRaw,
      blockTimestamp: new Date("2026-07-10T00:15:00.000Z")
    });

    const result = await buildIncomingDepositReport({
      deps: {
        listIndexedUsdtTransfersForAddress: async (address) => {
          if (address === sender) return [targetTransfer];
          if (address === gasFreeTlnt) {
            return [
              targetTransfer,
              indexedTransfer({
                txHash: feeTxHash,
                fromAddress: gasFreeAccount,
                toAddress: gasFreeTlnt,
                amountRaw,
                blockTimestamp: new Date("2026-07-10T00:10:00.000Z")
              }),
              indexedTransfer({
                txHash: "tx-large-corridor-binance-funding",
                fromAddress: binance,
                toAddress: gasFreeTlnt,
                amountRaw,
                blockTimestamp: new Date("2026-07-10T00:00:00.000Z")
              })
            ];
          }
          return [];
        },
        listRelatedTrc20Transfers: async () => [],
        getLabelsForAddress: async () => [],
        getClassificationForAddress: async (address): Promise<ServiceClassification | null> => address === binance
          ? { category: "cex", identity: "Binance", confidence: "high", evidence: ["tag:binance"], isBoundary: true }
          : null,
        getContractIntelligenceProfile: async () => null,
        getTransaction: async (txHash) => txHash === feeTxHash
          ? gasFreeTransaction(gasFreeReceiver, "1", amountRaw)
          : null,
        getUsdtRestrictionStatus: async (address) => ({ ...stablecoinProfile(address), balanceRaw: "0" })
      },
      job: job(validProgressJson),
      depositTxHash: depositHash,
      watchedWallet,
      sender,
      amountRaw,
      timestamp: new Date("2026-07-10T00:20:00.000Z")
    });

    const corridorBundle = result.originPaths
      .flatMap((path) => path.fundingBundles ?? [])
      .find((bundle) => bundle.targetTxHash === corridorTxHash);
    expect(corridorBundle).toMatchObject({
      fundingTxHashes: ["tx-large-corridor-binance-funding"],
      fundingAddresses: [binance]
    });
    expect(corridorBundle?.fundingTxHashes).not.toContain(feeTxHash);
  });

  it("preserves contract-driven profiles from nested where-is-money reports", async () => {
    const source = "TVictimSource111111111111111111111111";
    const contract = "TVerifyContract11111111111111111111";
    const caller = "TOperator1111111111111111111111111";
    const txHash = "verify20-funding";
    const amountRaw = "384064001319";

    const result = await buildIncomingDepositReport({
      deps: {
        listIndexedUsdtTransfersForAddress: async (address) =>
          address === validProgressJson.sender
            ? [indexedTransfer({
              txHash,
              fromAddress: source,
              toAddress: validProgressJson.sender,
              amountRaw,
              method: "transferFrom"
            })]
            : [],
        listRelatedTrc20Transfers: async () => [],
        getLabelsForAddress: async () => [],
        getClassificationForAddress: async () => null,
        getContractIntelligenceProfile: async () => null,
        getTransaction: async (requestedTxHash) => ({
          txHash: requestedTxHash,
          contractAddress: contract,
          ownerAddress: caller,
          method: "verify20(address token,address from,address to,uint256 amount)",
          contractInfo: { name: "VerifyAccount" },
          trc20TransferInfo: [{
            from_address: source,
            to_address: validProgressJson.sender,
            quant: amountRaw,
            tokenInfo: { tokenAbbr: "USDT" }
          }]
        }),
        getUsdtRestrictionStatus: async () => ({ ...stablecoinProfile(validProgressJson.sender), balanceRaw: "0" }),
        listTrc20ApprovalChanges: async () => []
      },
      job: job(validProgressJson),
      depositTxHash,
      watchedWallet: validProgressJson.watchedWallet,
      sender: validProgressJson.sender,
      amountRaw: validProgressJson.amountRaw,
      timestamp: new Date(validProgressJson.timestamp)
    });

    expect(result.contractDrivenSubjectAddress).toBe(validProgressJson.sender);
    expect(result.contractDrivenReceiverProfile).toEqual(expect.objectContaining({
      totalIncomingTxCount: 1,
      totalIncomingAmountRaw: amountRaw,
      contractDrivenIncomingTxCount: 1,
      contractDrivenIncomingAmountRaw: amountRaw,
      txInfoEnrichedIncomingTx: 1,
      campaignClassificationStatus: "complete",
      countsAreLowerBounds: false,
      plainUsdtTransferTxCount: 0,
      wrapperDrivenIncomingTxCount: 1,
      verify20WrapperTxCount: 1,
      dominantMethod: "Verify20",
      contractNames: ["VerifyAccount"]
    }));
    expect(result.contractDrivenTransferProfiles).toEqual(expect.arrayContaining([
      expect.objectContaining({
        txHash,
        amountRaw,
        method: "Verify20",
        contractAddress: contract,
        sourceAddress: source,
        receiverAddress: validProgressJson.sender
      })
    ]));
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
        getUsdtRestrictionStatus: async () => ({ ...stablecoinProfile(validProgressJson.sender), balanceRaw: "0" })
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
    expect(result.decision).toBe("REVIEW");
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
        getUsdtRestrictionStatus: async () => ({ ...stablecoinProfile(validProgressJson.sender), balanceRaw: "0" })
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
    expect(result.decision).toBe("REVIEW");
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
        getUsdtRestrictionStatus: async () => ({ ...stablecoinProfile(validProgressJson.sender), balanceRaw: "0" })
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
    expect(result.decision).toBe("REVIEW");
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
        getUsdtRestrictionStatus: async () => ({ ...stablecoinProfile(validProgressJson.sender), balanceRaw: "0" })
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
    expect(result).toMatchObject({
      decision: "NO_FINAL_DECISION",
      scoreValid: false,
      depositRiskScore: null,
      unifiedRiskSummary: { decisionBasis: "technical_stop" }
    });
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
        getUsdtRestrictionStatus: async () => ({ ...stablecoinProfile(validProgressJson.sender), balanceRaw: "0" })
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

  it("preserves minority contextual source-policy paths as review", async () => {
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

    expect(result.decision).toBe("REVIEW");
    expect(result.depositRiskScore).toBeLessThan(60);
    expect(result.hardBadEvidence).toEqual([]);
    expect(result.originPaths[0]).toEqual(expect.objectContaining({
      stoppedReason: "whitebit_reached",
      verdict: "REVIEW",
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

    expect(result).toMatchObject({
      decision: "NO_FINAL_DECISION",
      scoreValid: false,
      depositRiskScore: null,
      riskBand: null,
      unifiedRiskSummary: {
        finalScore: null,
        finalDecision: "NO_FINAL_DECISION",
        decisionBasis: "technical_stop",
        scoreAnchorV2: null,
        scoreAnchorDiagnostic: null
      }
    });
    expect(result.unifiedRiskSummary?.matrixDecision).toBe("DECLINE");
    expect(result.unifiedRiskSummary?.winningRow).toBe("source_policy");
    expect(result.unifiedRiskSummary?.policyScore).toBe(88);
    expect(result.unifiedRiskSummary?.calibratedRiskProbability).toBeNull();
    expect(result.sourcePolicyEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "no_name_token_liquidity", score: 88 })
    ]));
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

    expect(result).toMatchObject({
      decision: "NO_FINAL_DECISION",
      scoreValid: false,
      depositRiskScore: null,
      unifiedRiskSummary: { decisionBasis: "technical_stop" }
    });
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

    expect(result).toMatchObject({
      decision: "NO_FINAL_DECISION",
      scoreValid: false,
      depositRiskScore: null,
      unifiedRiskSummary: { decisionBasis: "technical_stop" }
    });
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
        getUsdtRestrictionStatus: async () => ({ ...stablecoinProfile(validProgressJson.sender), balanceRaw: "0" })
      },
      job: job(validProgressJson),
      depositTxHash,
      watchedWallet: validProgressJson.watchedWallet,
      sender: validProgressJson.sender,
      amountRaw: validProgressJson.amountRaw,
      timestamp: new Date(validProgressJson.timestamp)
    });

    expect(result.decision).toBe("REVIEW");
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
    expect(result.contractVerdicts).toEqual([]);
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
        getUsdtRestrictionStatus: async (address) => ({ ...stablecoinProfile(address), balanceRaw: "0" })
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

  it("keeps unresolved unknown-contract provenance in deterministic review without an LLM fallback", async () => {
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

    expect(result).toMatchObject({
      decision: "REVIEW",
      scoreValid: true,
      depositRiskScore: 55,
      riskBand: "MEDIUM",
      unifiedRiskSummary: {
        finalScore: 55,
        finalDecision: "REVIEW",
        decisionBasis: "matrix",
        scoreAnchorV2: expect.objectContaining({
          score: 55,
          decision: "REVIEW"
        }),
        scoreAnchorDiagnostic: null
      }
    });
    expect(result.contractVerdicts).toEqual([]);
    expect(result.reasons.join(" ")).not.toMatch(/LLM|deepseek|llm disabled/i);
  });

  it("treats enriched hot_wallet contracts as deterministic service context", async () => {
    const contract = "THotWallet11111111111111111111111111";
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
        getUsdtRestrictionStatus: async () => ({ ...stablecoinProfile(validProgressJson.sender), balanceRaw: "0" })
      },
      job: job(validProgressJson),
      depositTxHash,
      watchedWallet: validProgressJson.watchedWallet,
      sender: validProgressJson.sender,
      amountRaw: validProgressJson.amountRaw,
      timestamp: new Date(validProgressJson.timestamp)
    });

    expect(result.contractVerdicts).toEqual([]);
  });

  it("uses hard-boundary enrichment in final reports without an LLM call", async () => {
    const contract = "TFcRN111111111111111111111111FLR5hvh";
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
        getUsdtRestrictionStatus: async () => ({ ...stablecoinProfile(validProgressJson.sender), balanceRaw: "0" })
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
    expect(result.contractVerdicts).toEqual([]);
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

function queuedTargetedIndexState(input: {
  address: string;
  targetTimestamp?: Date | null;
  requestedByJobId?: string | null;
  queuedReason: string;
}): TronAddressUsdtIndexState {
  const now = new Date("2026-07-02T00:00:00.000Z");
  return {
    address: input.address,
    tokenContract: TRON_USDT_CONTRACT_ADDRESS,
    coverageMode: "targeted",
    coverageKind: "provider_windowed",
    targetTimestamp: input.targetTimestamp ?? null,
    status: "queued",
    statusReason: null,
    provider: null,
    totalReported: null,
    fetchedTransferCount: 0,
    uniqueCounterpartyCount: 0,
    newestTransferAt: null,
    oldestTransferAt: null,
    coveredUntilTimestamp: null,
    fetchedPageCount: 0,
    plannedPageCount: null,
    currentEndTimestamp: null,
    providerCapHit: false,
    budgetExhausted: false,
    providerInconsistent: false,
    priority: 0,
    nextRunAt: now,
    attemptCount: 0,
    maxAttempts: 5,
    retryCount: 0,
    lastError: null,
    lastErrorClass: null,
    lastSuccessfulPageAt: null,
    queuedReason: input.queuedReason,
    requestedByJobId: input.requestedByJobId ?? null,
    lockedAt: null,
    lockedUntil: null,
    heartbeatAt: null,
    lockOwner: null,
    budgetPages: null,
    budgetSeconds: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now
  };
}
