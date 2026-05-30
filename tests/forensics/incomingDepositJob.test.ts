import { describe, expect, it, vi } from "vitest";
import type { ForensicCheckJob } from "../../src/storage/repositories";
import { buildIncomingDepositReport, runSingleIncomingDepositJobCycle } from "../../src/forensics/incomingDepositJob";
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

describe("buildIncomingDepositReport", () => {
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
      expect.objectContaining({ kind: "scam_or_blacklist" }),
      expect.objectContaining({ kind: "llm_contract_suspicion" })
    ]));
    expect(result.warnings).toContain("Sender current balance is zero after outgoing deposit; balance-origin mode is not applicable.");
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
    expect(result.decision).toBe("ACCEPTABLE");
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
    expect(result.warnings).toContain("Incoming deposit provenance search was extended beyond the fast depth budget.");
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
    expect(result.warnings).toContain("Incoming deposit provenance search was extended beyond the fast depth budget.");
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

    expect(result.originPaths[0]).toEqual(expect.objectContaining({
      stoppedReason: "htx_huobi_reached",
      sourcePolicy: "hard_decline"
    }));
    expect(result.warnings).not.toContain("Incoming deposit provenance search was extended beyond the fast depth budget.");
  });

  it("uses depth 12 instead of depth 8 for large deposits", async () => {
    const chain = provenanceChain(12, "TBinanceDepthTwelve1111111111111111");

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
      proximityHops: 12
    }));
    expect(result.warnings).toContain("Incoming deposit provenance search was extended beyond the fast depth budget.");
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
    expect(result.depositRiskScore).toBeLessThanOrEqual(35);
    expect(result.originPaths[0]?.stoppedReason).toBe("unknown_contract_reached");
    expect(result.contractVerdicts[0]).toEqual(expect.objectContaining({
      source: "deterministic",
      verdict: "legitimate_service",
      decisionRecommendation: "ACCEPTABLE"
    }));
    expect(analyzeLlm).not.toHaveBeenCalled();
    expect(enrichContractClassification).toHaveBeenCalledWith(contract);
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
    expect(result.hardBadEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "htx_huobi_source" })
    ]));
    expect(result.depositRiskScore).toBeGreaterThanOrEqual(78);
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
