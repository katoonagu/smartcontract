import { describe, expect, it, vi } from "vitest";
import type { DeepAddressForensicReport } from "../../src/check/deepForensicCheck";
import type { CrossChainTransfer } from "../../src/forensics/crossChainProviders";
import { runSingleDeepForensicJobCycle } from "../../src/forensics/deepForensicJob";
import { TRON_USDT_CONTRACT_ADDRESS, type RawTronscanTrc20Transfer } from "../../src/parser/transactionParser";
import { deepForensicRuntimeOptions } from "../../src/runtime/deepForensicRuntimeOptions";
import type { AddressLabelAssertionInput, ForensicCheckJob } from "../../src/storage/repositories";
import type { CrossChainEvidenceRef, ProviderPayloadRef, AddressLabel, StablecoinRestrictionProfile, WhereIsMoneyReport } from "../../src/types";
import type { TronscanApprovalChange } from "../../src/tron/tronClient";

const subject = "TSubject111111111111111111111111111111";
const transit = "TTransit111111111111111111111111111111";
const seed = "TYFkLfEzv5eYgAxANwdGd26KyQwRZYiqtV";
const victim = "TVictim111111111111111111111111111111";
const spender = "TSpender11111111111111111111111111111";

function transfer(input: {
  id: string;
  from: string;
  to: string;
  amountRaw: string;
  at: string;
  triggerInfo?: unknown;
}): RawTronscanTrc20Transfer {
  return {
    transaction_id: input.id,
    from_address: input.from,
    to_address: input.to,
    quant: input.amountRaw,
    contract_address: TRON_USDT_CONTRACT_ADDRESS,
    confirmed: true,
    contractRet: "SUCCESS",
    block_ts: Date.parse(input.at),
    trigger_info: input.triggerInfo
  };
}

function job(): ForensicCheckJob {
  return {
    id: "job-1",
    kind: "address_deep_check",
    subjectAddress: subject,
    status: "running",
    windowStart: new Date("2026-05-01T00:00:00.000Z"),
    windowEnd: new Date("2026-05-24T00:00:00.000Z"),
    priority: 100,
    chatId: "42",
    messageId: null,
    requestedBy: "42",
    progressJson: { fastRiskSnapshot: { score: 0, level: "LOW" } },
    resultJson: {},
    rawEvidenceIds: [],
    observationIds: [],
    lastError: null,
    createdAt: new Date("2026-05-24T00:00:00.000Z"),
    updatedAt: new Date("2026-05-24T00:00:00.000Z"),
    startedAt: new Date("2026-05-24T00:00:00.000Z"),
    completedAt: null
  };
}

function darknetExchangeLabel(address: string): AddressLabel {
  return {
    address,
    label: "darknet_exchange",
    source: "service_admin",
    createdByTelegramId: "9001",
    createdAt: new Date("2026-05-01T00:00:00.000Z")
  };
}

function darknetExchangeProximityLabel(address: string): AddressLabel {
  return {
    address,
    label: "darknet_exchange_proximity",
    source: "system",
    createdByTelegramId: null,
    createdAt: new Date("2026-05-01T00:00:00.000Z")
  };
}

function usdtRestrictionProfile(overrides: Partial<StablecoinRestrictionProfile> = {}): StablecoinRestrictionProfile {
  return {
    subjectAddress: subject,
    tokenContract: TRON_USDT_CONTRACT_ADDRESS,
    tokenSymbol: "USDT",
    tokenStandard: "TRC20",
    decimals: 6,
    isBlacklisted: false,
    balanceRaw: null,
    checkedAt: "2026-05-24T00:00:00.000Z",
    evidenceStrength: "exact_contract_state",
    blacklistEventTxHash: null,
    blacklistEventTimestamp: null,
    blacklistEventBlock: null,
    methods: {
      blacklist: "isBlackListed(address)",
      balance: "balanceOf(address)"
    },
    ...overrides
  };
}

function approval(overrides: Partial<TronscanApprovalChange> = {}): TronscanApprovalChange {
  return {
    txHash: "tx-approval",
    ownerAddress: victim,
    spenderAddress: spender,
    tokenContract: TRON_USDT_CONTRACT_ADDRESS,
    amountRaw: "400000000000",
    isUnlimited: false,
    timestamp: new Date("2026-05-20T09:50:00.000Z"),
    confirmed: true,
    contractRet: "SUCCESS",
    ...overrides
  };
}

function emptyDeepReport(): DeepAddressForensicReport {
  return {
    subjectAddress: subject,
    windowStart: new Date("2026-05-01T00:00:00.000Z"),
    windowEnd: new Date("2026-05-24T00:00:00.000Z"),
    runProfile: "production_full",
    providerBudget: {
      providerCallBudget: null,
      transferCallBudget: null,
      contractCallBudget: null,
      approvalCallBudget: null,
      elapsedTimeBudgetMs: null,
      exhausted: false
    },
    rawEvidence: [],
    observations: [],
    missingChecks: [],
    serviceExposureProfiles: [],
    addressBehaviorProfiles: [],
    inboundProvenanceProfiles: [],
    counterpartyRiskProfiles: [],
    directCounterpartyInteractionProfiles: [],
    approvalDrainProvenanceProfiles: [],
    boundaryExposureProfiles: [],
    operationalFlowProfiles: [],
    walletRoleProfiles: [],
    extendedProvenanceProfiles: [],
    coverage: {
      sourceTransferPages: 0,
      inboundSendersExpanded: 0,
      transferEdges: 0
    },
    coverageDebug: {
      jobId: null,
      subjectAddress: subject,
      status: null,
      windowStart: "2026-05-01T00:00:00.000Z",
      windowEnd: "2026-05-24T00:00:00.000Z",
      summary: {
        sourceTransferPages: 0,
        transferEdges: 0,
        inboundSendersExpanded: 0,
        extendedIndexedEdges: 0,
        extendedFetchedAddresses: 0,
        apiKeyConfigured: null,
        thirtyDayTransferCount: 0,
        historicalFallbackTransferCount: 0,
        historicalFallbackRequestedLimit: null,
        directCounterpartyCount: 0,
        analyzedCounterpartyCount: 0,
        expandedCounterpartyCount: 0,
        metadataEnrichedCounterpartyCount: 0,
        skippedCounterpartyCount: 0,
        legacyPartial: false
      },
      rows: [],
      missingChecks: [],
      notes: []
    }
  };
}

describe("deep forensic job runner", () => {
  it("passes production Deep Research defaults into address jobs", async () => {
    vi.resetModules();
    const runDeepAddressForensicCheck = vi.fn(async () => emptyDeepReport());
    vi.doMock("../../src/check/deepForensicCheck", async (importOriginal) => ({
      ...await importOriginal<typeof import("../../src/check/deepForensicCheck")>(),
      runDeepAddressForensicCheck
    }));

    try {
      const { runSingleDeepForensicJobCycle: runCycleWithMock } = await import("../../src/forensics/deepForensicJob");

      const handled = await runCycleWithMock({
        claimNextForensicCheckJob: async () => job(),
        completeForensicCheckJob: vi.fn(async () => true),
        recordRiskEvaluation: vi.fn(async () => undefined),
        tronClient: {
          listRelatedTrc20Transfers: async () => []
        },
        getLabelsForAddress: async () => [],
        getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({ subjectAddress: address })
      });

      expect(handled).toBe(true);
      expect(runDeepAddressForensicCheck).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          maxDepth: 3,
          pageLimit: 100,
          maxPagesPerAddress: 3,
          maxExpandedIntermediates: 30,
          metadataFetchLimit: 30,
          contractProfileFetchLimit: 15,
          maxInboundSenders: 15,
          maxApprovalDrainCandidates: 15,
          approvalChangeLookupLimit: 20,
          extendedSearchMode: "always",
          extendedSearchMaxDepth: 6,
          extendedSearchBeamWidth: 12,
          extendedSearchMaxAddressFetches: 150,
          recentFallbackMinTransferCount: 150,
          recentFallbackTransferLimit: 150,
          counterpartyFastSnapshotLimit: 60,
          counterpartyFastSnapshotActiveLimit: 30
        })
      );
    } finally {
      vi.doUnmock("../../src/check/deepForensicCheck");
      vi.resetModules();
    }
  });

  it("runs where-is-money jobs through the balance-origin path", async () => {
    const sourceJob: ForensicCheckJob = {
      ...job(),
      kind: "where_is_money_check",
      priority: 120,
      progressJson: { fastRiskSnapshot: { score: 9, level: "LOW" }, locale: "en" }
    };
    const transfersByAddress = new Map<string, RawTronscanTrc20Transfer[]>([
      [
        subject,
        [
          transfer({
            id: "tx-transit-subject",
            from: transit,
            to: subject,
            amountRaw: "95000000000",
            at: "2026-05-20T10:00:00.000Z"
          })
        ]
      ],
      [
        transit,
        [
          transfer({
            id: "tx-seed-transit",
            from: seed,
            to: transit,
            amountRaw: "100000000000",
            at: "2026-05-20T09:55:00.000Z"
          }),
          transfer({
            id: "tx-transit-subject",
            from: transit,
            to: subject,
            amountRaw: "95000000000",
            at: "2026-05-20T10:00:00.000Z"
          })
        ]
      ]
    ]);
    const completeForensicCheckJob = vi.fn(async (_input: Parameters<Parameters<typeof runSingleDeepForensicJobCycle>[0]["completeForensicCheckJob"]>[0]) => true);
    const sendWhereIsMoneyJobResult = vi.fn(async () => undefined);
    const recordRiskEvaluation = vi.fn(async () => undefined);

    const handled = await runSingleDeepForensicJobCycle({
      claimNextForensicCheckJob: async () => sourceJob,
      completeForensicCheckJob,
      recordRiskEvaluation,
      tronClient: {
        listRelatedTrc20Transfers: async (address) => transfersByAddress.get(address) ?? []
      },
      getLabelsForAddress: async (address) => address === seed ? [darknetExchangeLabel(address)] : [],
      getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({ subjectAddress: address, balanceRaw: address === subject ? "95000000000" : null }),
      sendWhereIsMoneyJobResult
    }, {
      recentFallbackMinTransferCount: 60,
      maxEdgesPerAddress: 60,
      recentFallbackTransferLimit: 60
    });

    expect(handled).toBe(true);
    expect(recordRiskEvaluation).not.toHaveBeenCalled();
    expect(completeForensicCheckJob).toHaveBeenCalledWith(expect.objectContaining({
      id: "job-1",
      status: "completed",
      rawEvidenceIds: [],
      observationIds: [],
      lastError: null
    }));
    expect(completeForensicCheckJob.mock.calls[0][0].resultJson).toMatchObject({
      subjectAddress: subject,
      whereIsMoneyReport: {
        decision: "DECLINE",
        riskScore: expect.any(Number),
        coverage: expect.objectContaining({
          maxDepth: 20
        })
      }
    });
    expect(sendWhereIsMoneyJobResult).toHaveBeenCalledWith(
      sourceJob,
      expect.objectContaining({ decision: "DECLINE" }),
      "completed"
    );
  });

  it("uses runtime where-is-money fetch limits for indexed and live edge pages", async () => {
    const sourceJob: ForensicCheckJob = {
      ...job(),
      kind: "where_is_money_check",
      priority: 120,
      progressJson: { fastRiskSnapshot: { score: 0, level: "LOW" }, locale: "en" }
    };
    const timestampMs = (value: unknown): number | null => {
      if (value instanceof Date) return value.getTime();
      if (typeof value === "number") return value;
      return null;
    };
    const indexedCalls: Array<{ address: string; minTimestampMs: number | null; maxTimestampMs: number | null; limit?: number }> = [];
    const liveCalls: Array<{ address: string; minTimestampMs: number | null; endTimestampMs: number | null; limit?: number }> = [];
    const completeForensicCheckJob = vi.fn(async (_input: Parameters<Parameters<typeof runSingleDeepForensicJobCycle>[0]["completeForensicCheckJob"]>[0]) => true);

    const handled = await runSingleDeepForensicJobCycle({
      claimNextForensicCheckJob: async () => sourceJob,
      completeForensicCheckJob,
      recordRiskEvaluation: vi.fn(async () => undefined),
      listIndexedUsdtTransfersForAddress: async (address, options) => {
        indexedCalls.push({
          address,
          minTimestampMs: timestampMs(options?.minTimestamp),
          maxTimestampMs: timestampMs(options?.maxTimestamp),
          limit: options?.limit
        });
        return [];
      },
      tronClient: {
        listRelatedTrc20Transfers: async (address, options) => {
          liveCalls.push({
            address,
            minTimestampMs: timestampMs(options?.minTimestamp),
            endTimestampMs: timestampMs(options?.endTimestamp),
            limit: options?.limit
          });
          return [];
        }
      },
      getLabelsForAddress: async () => [],
      getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({
        subjectAddress: address,
        balanceRaw: address === subject ? "1000000" : null
      })
    }, deepForensicRuntimeOptions({
      tronscanPageLimit: 100,
      crossChainStage2Enabled: false,
      crossChainStage2MaxProviderCalls: 3
    }, true));

    expect(handled).toBe(true);
    expect(indexedCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({ address: subject, minTimestampMs: sourceJob.windowStart.getTime(), limit: 150 }),
      expect.objectContaining({ address: subject, minTimestampMs: 0, limit: 150 })
    ]));
    expect(liveCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({ address: subject, minTimestampMs: sourceJob.windowStart.getTime(), limit: 100 }),
      expect.objectContaining({ address: subject, minTimestampMs: null, endTimestampMs: null, limit: 100 })
    ]));
    expect(liveCalls.every((call) => call.limit === undefined || call.limit <= 100)).toBe(true);
  });

  it("preserves fast-risk reason codes across queued where-is-money jobs", async () => {
    const sourceJob: ForensicCheckJob = {
      ...job(),
      kind: "where_is_money_check",
      priority: 120,
      progressJson: {
        fastRiskSnapshot: {
          score: 90,
          level: "CRITICAL",
          reasons: [{
            code: "stablecoin_usdt_blacklisted",
            message: "Official TRON USDT contract blacklist state is active for this address.",
            scoreImpact: 90,
            evidenceRef: "usdt-blacklist-evidence"
          }]
        },
        locale: "en"
      }
    };
    const completeForensicCheckJob = vi.fn(async (_input: Parameters<Parameters<typeof runSingleDeepForensicJobCycle>[0]["completeForensicCheckJob"]>[0]) => true);

    const handled = await runSingleDeepForensicJobCycle({
      claimNextForensicCheckJob: async () => sourceJob,
      completeForensicCheckJob,
      recordRiskEvaluation: vi.fn(async () => undefined),
      tronClient: {
        listRelatedTrc20Transfers: async () => []
      },
      getLabelsForAddress: async () => [],
      getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({
        subjectAddress: address,
        balanceRaw: address === subject ? "1000000" : null
      })
    }, {
      recentFallbackMinTransferCount: 60,
      maxEdgesPerAddress: 60,
      recentFallbackTransferLimit: 60
    });

    expect(handled).toBe(true);
    const result = completeForensicCheckJob.mock.calls[0][0].resultJson as { whereIsMoneyReport: WhereIsMoneyReport };
    expect(result.whereIsMoneyReport.fastWalletRisk?.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "stablecoin_usdt_blacklisted",
        evidenceRef: "usdt-blacklist-evidence"
      })
    ]));
  });

  it("preserves wallet_profile mode for zero-balance queued where-is-money jobs", async () => {
    const zeroBalanceReason = "Current USDT balance is zero; balance-origin mode is not applicable for this wallet profile check.";
    const sourceJob: ForensicCheckJob = {
      ...job(),
      kind: "where_is_money_check",
      priority: 120,
      progressJson: { fastRiskSnapshot: { score: 0, level: "LOW" }, locale: "en", mode: "wallet_profile" }
    };
    const completeForensicCheckJob = vi.fn(async (_input: Parameters<Parameters<typeof runSingleDeepForensicJobCycle>[0]["completeForensicCheckJob"]>[0]) => true);

    const handled = await runSingleDeepForensicJobCycle({
      claimNextForensicCheckJob: async () => sourceJob,
      completeForensicCheckJob,
      recordRiskEvaluation: vi.fn(async () => undefined),
      tronClient: {
        listRelatedTrc20Transfers: async () => []
      },
      getLabelsForAddress: async () => [],
      getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({
        subjectAddress: address,
        balanceRaw: address === subject ? "0" : null
      })
    }, {
      recentFallbackMinTransferCount: 60,
      maxEdgesPerAddress: 60,
      recentFallbackTransferLimit: 60
    });

    expect(handled).toBe(true);
    const result = completeForensicCheckJob.mock.calls[0][0].resultJson as { whereIsMoneyReport: WhereIsMoneyReport };
    expect(result.whereIsMoneyReport).toMatchObject({
      currentUsdtBalanceRaw: "0",
      decision: "ACCEPTABLE",
      riskScore: 0,
      coverage: expect.objectContaining({
        selectedInboundTxCount: 0,
        partial: false
      })
    });
    expect(result.whereIsMoneyReport.coverage.notes).toContain(zeroBalanceReason);
    expect(result.whereIsMoneyReport.decisionReasons).toContain(zeroBalanceReason);
    expect(result.whereIsMoneyReport.assessment.reasons).toContain(zeroBalanceReason);
    expect(result.whereIsMoneyReport.decisionReasons.join(" ")).not.toContain("Clean source could not be proven");
  });

  it("keeps live-only trace history coverage incomplete when the live page may be truncated", async () => {
    const sourceJob: ForensicCheckJob = {
      ...job(),
      kind: "where_is_money_check",
      priority: 120,
      progressJson: { fastRiskSnapshot: { score: 0, level: "LOW" }, locale: "en" }
    };
    const liveLimit = 60;
    const unrelatedLiveRows = Array.from({ length: liveLimit }, (_, index) =>
      transfer({
        id: `tx-live-page-${index}`,
        from: transit,
        to: `TOut${index.toString().padStart(30, "0")}`,
        amountRaw: "1000000",
        at: `2026-05-20T09:${String(index % 60).padStart(2, "0")}:00.000Z`
      })
    );
    const completeForensicCheckJob = vi.fn(async (_input: Parameters<Parameters<typeof runSingleDeepForensicJobCycle>[0]["completeForensicCheckJob"]>[0]) => true);

    const handled = await runSingleDeepForensicJobCycle({
      claimNextForensicCheckJob: async () => sourceJob,
      completeForensicCheckJob,
      recordRiskEvaluation: vi.fn(async () => undefined),
      listIndexedUsdtTransfersForAddress: async () => [],
      tronClient: {
        listRelatedTrc20Transfers: async (address) => {
          if (address === subject) {
            return [transfer({
              id: "tx-transit-subject",
              from: transit,
              to: subject,
              amountRaw: "95000000000",
              at: "2026-05-20T10:00:00.000Z"
            })];
          }
          if (address === transit) return unrelatedLiveRows;
          return [];
        }
      },
      getLabelsForAddress: async () => [],
      getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({
        subjectAddress: address,
        balanceRaw: address === subject ? "95000000000" : null
      })
    }, {
      recentFallbackMinTransferCount: liveLimit,
      maxEdgesPerAddress: liveLimit,
      recentFallbackTransferLimit: liveLimit
    });

    expect(handled).toBe(true);
    const result = completeForensicCheckJob.mock.calls[0][0].resultJson as { whereIsMoneyReport: WhereIsMoneyReport };
    const path = result.whereIsMoneyReport.originPaths.find((originPath) => originPath.balanceTransferTxHash === "tx-transit-subject");
    expect(path?.stoppedReason).toBe("incoming_history_not_fetched");
    expect(path?.historyCoverage).toEqual(expect.arrayContaining([
      expect.objectContaining({
        address: transit,
        fetchedTransferCount: liveLimit,
        fetchedPageCount: 2,
        reachedTargetHop: false,
        source: "live"
      })
    ]));
  });

  it("does not treat failed transit history fetches as reached history", async () => {
    const sourceJob: ForensicCheckJob = {
      ...job(),
      kind: "where_is_money_check",
      priority: 120,
      progressJson: { fastRiskSnapshot: { score: 0, level: "LOW" }, locale: "en" }
    };
    const completeForensicCheckJob = vi.fn(async (_input: Parameters<Parameters<typeof runSingleDeepForensicJobCycle>[0]["completeForensicCheckJob"]>[0]) => true);

    const handled = await runSingleDeepForensicJobCycle({
      claimNextForensicCheckJob: async () => sourceJob,
      completeForensicCheckJob,
      recordRiskEvaluation: vi.fn(async () => undefined),
      listIndexedUsdtTransfersForAddress: async (address) => {
        if (address === transit) throw new Error("index unavailable");
        return [];
      },
      tronClient: {
        listRelatedTrc20Transfers: async (address) => {
          if (address === subject) {
            return [transfer({
              id: "tx-transit-subject",
              from: transit,
              to: subject,
              amountRaw: "95000000000",
              at: "2026-05-20T10:00:00.000Z"
            })];
          }
          if (address === transit) throw new Error("provider unavailable");
          return [];
        }
      },
      getLabelsForAddress: async () => [],
      getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({
        subjectAddress: address,
        balanceRaw: address === subject ? "95000000000" : null
      })
    }, {
      recentFallbackMinTransferCount: 60,
      maxEdgesPerAddress: 60,
      recentFallbackTransferLimit: 60
    });

    expect(handled).toBe(true);
    const result = completeForensicCheckJob.mock.calls[0][0].resultJson as { whereIsMoneyReport: WhereIsMoneyReport };
    const path = result.whereIsMoneyReport.originPaths.find((originPath) => originPath.balanceTransferTxHash === "tx-transit-subject");
    expect(path?.stoppedReason).toBe("incoming_history_not_fetched");
    expect(path?.historyCoverage).toEqual(expect.arrayContaining([
      expect.objectContaining({
        address: transit,
        fetchedTransferCount: 0,
        reachedTargetHop: false
      })
    ]));
  });

  it("forwards Stage 2 providers and options into where-is-money jobs", async () => {
    const sourceJob: ForensicCheckJob = {
      ...job(),
      kind: "where_is_money_check",
      priority: 120,
      progressJson: { fastRiskSnapshot: { score: 9, level: "LOW" }, locale: "en" }
    };
    const transfersByAddress = new Map<string, RawTronscanTrc20Transfer[]>([
      [
        subject,
        [
          transfer({
            id: "tx-transit-subject",
            from: transit,
            to: subject,
            amountRaw: "95000000000",
            at: "2026-05-20T10:00:00.000Z"
          })
        ]
      ],
      [
        transit,
        [
          transfer({
            id: "tx-seed-transit",
            from: seed,
            to: transit,
            amountRaw: "100000000000",
            at: "2026-05-20T09:55:00.000Z"
          }),
          transfer({
            id: "tx-transit-subject",
            from: transit,
            to: subject,
            amountRaw: "95000000000",
            at: "2026-05-20T10:00:00.000Z"
          })
        ]
      ]
    ]);
    const payloadRef: ProviderPayloadRef = {
      id: "range:transfers/by-tx:tron:tx-seed-transit",
      provider: "range",
      endpoint: "transfers/by-tx",
      fetchedAt: "2026-05-20T10:01:00.000Z"
    };
    const evidenceRef: CrossChainEvidenceRef = {
      id: "range:ethereum:tx-seed-transit:bridge_source",
      provider: "range",
      payloadId: payloadRef.id,
      confidence: "provider_correlated"
    };
    const crossChainTransfer: CrossChainTransfer = {
      id: "range-transfer-1",
      protocol: "LayerZero/Stargate",
      source: { chain: "tron", chainId: "tron-mainnet", address: seed },
      destination: { chain: "ethereum", chainId: 1, address: "0x2222222222222222222222222222222222222222" },
      sourceTxHash: "tx-seed-transit",
      destinationTxHash: "0xstage2",
      assetSymbol: "USDT",
      amountRaw: "100000000000",
      decimals: 6,
      timestamp: "2026-05-20T09:55:00.000Z",
      evidenceRefs: [evidenceRef],
      payloadRef,
      labels: ["bridge"]
    };
    const crossChainDiscoveryProvider = {
      findTransfersByTx: vi.fn(async () => [crossChainTransfer]),
      findTransfersByAddress: vi.fn(async () => []),
      getAddressRisk: vi.fn(async () => null)
    };
    const evmEvidenceProvider = {
      listNormalTransactions: vi.fn(async () => []),
      listInternalTransactions: vi.fn(async () => []),
      listErc20Transfers: vi.fn(async () => []),
      getTransactionReceipt: vi.fn(async () => null),
      getLogs: vi.fn(async () => []),
      getTokenMetadata: vi.fn(async () => null)
    };
    const completeForensicCheckJob = vi.fn(async (_input: Parameters<Parameters<typeof runSingleDeepForensicJobCycle>[0]["completeForensicCheckJob"]>[0]) => true);
    const updateForensicCheckJobProgress = vi.fn(async (_input: {
      id: string;
      progressJson: Record<string, unknown>;
      lastError?: string | null;
    }) => true);

    const handled = await runSingleDeepForensicJobCycle({
      claimNextForensicCheckJob: async () => sourceJob,
      updateForensicCheckJobProgress,
      completeForensicCheckJob,
      recordRiskEvaluation: vi.fn(async () => undefined),
      tronClient: {
        listRelatedTrc20Transfers: async (address) => transfersByAddress.get(address) ?? []
      },
      getLabelsForAddress: async (address) => address === seed ? [darknetExchangeLabel(address)] : [],
      getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({ subjectAddress: address, balanceRaw: address === subject ? "95000000000" : null }),
      crossChainDiscoveryProvider,
      evmEvidenceProvider
    }, {
      recentFallbackMinTransferCount: 60,
      maxEdgesPerAddress: 60,
      recentFallbackTransferLimit: 60,
      crossChainStage2Enabled: true,
      crossChainManualDeepMode: true,
      crossChainMaxProviderCalls: 1
    });

    expect(handled).toBe(true);
    expect(crossChainDiscoveryProvider.findTransfersByTx).toHaveBeenCalledTimes(1);
    expect(crossChainDiscoveryProvider.findTransfersByAddress).not.toHaveBeenCalled();
    expect(evmEvidenceProvider.listNormalTransactions).not.toHaveBeenCalled();
    expect(updateForensicCheckJobProgress).toHaveBeenCalledTimes(2);
    expect(updateForensicCheckJobProgress.mock.calls[0][0]).toMatchObject({
      id: "job-1",
      lastError: null,
      progressJson: {
        locale: "en",
        jobPhase: "money_origin_trace",
        jobHeartbeatAt: expect.any(String),
        crossChainStage2Progress: {
          enabled: true,
          manualDeepMode: true,
          status: "pending",
          updatedAt: expect.any(String)
        }
      }
    });
    expect(updateForensicCheckJobProgress.mock.calls[1][0]).toMatchObject({
      id: "job-1",
      lastError: null,
      progressJson: {
        locale: "en",
        jobPhase: "cross_chain_stage2",
        jobHeartbeatAt: expect.any(String),
        crossChainStage2Progress: {
          enabled: true,
          manualDeepMode: true,
          status: "running",
          triggered: true,
          reason: "manual_deep_mode",
          selectedAmountRaw: "95000000000",
          targetAmountRaw: "95000000000",
          providerCalls: 0,
          updatedAt: expect.any(String)
        }
      }
    });
    expect(completeForensicCheckJob.mock.calls[0][0].resultJson).toMatchObject({
      whereIsMoneyReport: {
        crossChainCorridor: {
          enabled: true,
          triggered: true,
          providerCalls: 1
        }
      }
    });
    expect(completeForensicCheckJob.mock.calls[0][0].progressJson).toMatchObject({
      locale: "en",
      jobPhase: "cross_chain_stage2",
      crossChainStage2Progress: updateForensicCheckJobProgress.mock.calls[1][0].progressJson.crossChainStage2Progress,
      whereIsMoneyCoverage: expect.any(Object),
      decision: expect.any(String),
      riskScore: expect.any(Number)
    });
  });

  it("does not run cross-chain Stage 2 for unseeded runtime jobs", async () => {
    const sourceJob: ForensicCheckJob = {
      ...job(),
      kind: "where_is_money_check",
      priority: 120,
      progressJson: { fastRiskSnapshot: { score: 9, level: "LOW" }, locale: "en" }
    };
    const transfersByAddress = new Map<string, RawTronscanTrc20Transfer[]>([[
      subject,
      [transfer({
        id: "tx-clean-subject",
        from: transit,
        to: subject,
        amountRaw: "95000000000",
        at: "2026-05-20T10:00:00.000Z"
      })]
    ]]);
    const crossChainDiscoveryProvider = {
      findTransfersByTx: vi.fn(async () => []),
      findTransfersByAddress: vi.fn(async () => []),
      getAddressRisk: vi.fn(async () => null)
    };
    const completeForensicCheckJob = vi.fn(async (_input: Parameters<Parameters<typeof runSingleDeepForensicJobCycle>[0]["completeForensicCheckJob"]>[0]) => true);

    const handled = await runSingleDeepForensicJobCycle({
      claimNextForensicCheckJob: async () => sourceJob,
      completeForensicCheckJob,
      recordRiskEvaluation: vi.fn(async () => undefined),
      tronClient: {
        listRelatedTrc20Transfers: async (address) => transfersByAddress.get(address) ?? []
      },
      getLabelsForAddress: async () => [],
      getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({ subjectAddress: address, balanceRaw: address === subject ? "95000000000" : null }),
      crossChainDiscoveryProvider
    }, {
      recentFallbackMinTransferCount: 60,
      maxEdgesPerAddress: 60,
      recentFallbackTransferLimit: 60,
      crossChainStage2Enabled: true,
      crossChainMaxProviderCalls: 1
    });

    expect(handled).toBe(true);
    expect(crossChainDiscoveryProvider.findTransfersByTx).not.toHaveBeenCalled();
    expect(crossChainDiscoveryProvider.findTransfersByAddress).not.toHaveBeenCalled();
    const result = completeForensicCheckJob.mock.calls[0][0].resultJson;
    const whereReport = result.whereIsMoneyReport as { crossChainCorridor?: unknown } | undefined;
    expect(whereReport?.crossChainCorridor).toBeUndefined();
  });

  it("persists address-deep trace progress before completing address jobs", async () => {
    const calls: string[] = [];
    const updateForensicCheckJobProgress = vi.fn(async (_input: {
      id: string;
      progressJson: Record<string, unknown>;
      lastError?: string | null;
    }) => {
      calls.push("progress");
      return true;
    });
    const completeForensicCheckJob = vi.fn(async (_input: Parameters<Parameters<typeof runSingleDeepForensicJobCycle>[0]["completeForensicCheckJob"]>[0]) => {
      calls.push("complete");
      return true;
    });

    const handled = await runSingleDeepForensicJobCycle({
      claimNextForensicCheckJob: async () => job(),
      updateForensicCheckJobProgress,
      completeForensicCheckJob,
      recordRiskEvaluation: vi.fn(async () => undefined),
      tronClient: {
        listRelatedTrc20Transfers: async () => []
      },
      getLabelsForAddress: async () => [],
      getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({ subjectAddress: address })
    }, {
      pageLimit: 10,
      maxPagesPerAddress: 1,
      maxExpandedIntermediates: 0,
      metadataFetchLimit: 0,
      contractProfileFetchLimit: 0,
      maxInboundSenders: 0
    });

    expect(handled).toBe(true);
    expect(calls[0]).toBe("progress");
    expect(calls.at(-1)).toBe("complete");
    expect(updateForensicCheckJobProgress).toHaveBeenCalledWith(expect.objectContaining({
      id: "job-1",
      lastError: null,
      progressJson: expect.objectContaining({
        fastRiskSnapshot: { score: 0, level: "LOW" },
        jobPhase: "address_deep_trace",
        jobHeartbeatAt: expect.any(String)
      })
    }));
    expect(completeForensicCheckJob.mock.calls[0][0].progressJson).toMatchObject({
      jobPhase: "address_deep_trace",
      fastRiskSnapshot: { score: 0, level: "LOW" }
    });
  });

  it("persists a system-derived high-risk marker for exact darknet exchange provenance", async () => {
    const transfersByAddress = new Map<string, RawTronscanTrc20Transfer[]>([
      [
        subject,
        [
          transfer({
            id: "tx-transit-subject",
            from: transit,
            to: subject,
            amountRaw: "95000000000",
            at: "2026-05-20T10:00:00.000Z"
          })
        ]
      ],
      [
        transit,
        [
          transfer({
            id: "tx-seed-transit",
            from: seed,
            to: transit,
            amountRaw: "100000000000",
            at: "2026-05-20T09:55:00.000Z"
          }),
          transfer({
            id: "tx-transit-subject",
            from: transit,
            to: subject,
            amountRaw: "95000000000",
            at: "2026-05-20T10:00:00.000Z"
          })
        ]
      ]
    ]);
    const upsertAddressLabelAssertion = vi.fn(async (_input: AddressLabelAssertionInput) => undefined);
    const completeForensicCheckJob = vi.fn(async (_input: Parameters<Parameters<typeof runSingleDeepForensicJobCycle>[0]["completeForensicCheckJob"]>[0]) => true);

    const handled = await runSingleDeepForensicJobCycle({
      claimNextForensicCheckJob: async () => job(),
      completeForensicCheckJob,
      recordRiskEvaluation: vi.fn(async () => undefined),
      upsertAddressLabelAssertion,
      tronClient: {
        listRelatedTrc20Transfers: async (address) => transfersByAddress.get(address) ?? []
      },
      getLabelsForAddress: async (address) => address === seed ? [darknetExchangeLabel(address)] : [],
      getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({ subjectAddress: address })
    }, {
      pageLimit: 10,
      maxPagesPerAddress: 1,
      maxExpandedIntermediates: 0,
      metadataFetchLimit: 0,
      contractProfileFetchLimit: 0,
      maxInboundSenders: 1
    });

    expect(handled).toBe(true);
    expect(upsertAddressLabelAssertion).toHaveBeenCalledWith(expect.objectContaining({
      id: `derived_tron_darknet_exchange_proximity_${subject}`,
      chain: "tron",
      address: subject,
      label: "darknet_exchange_proximity",
      category: "darknet_exchange_proximity",
      confidence: "high",
      severity: "high",
      status: "active",
      sourceName: "forensic_route_search",
      createdByTelegramId: null,
      derivedLabelSource: "system"
    }));
    expect(upsertAddressLabelAssertion.mock.calls[0][0].evidenceJson).toMatchObject({
      subjectAddress: subject,
      seedAddress: seed,
      hopDepth: 2,
      viaAddresses: [transit],
      txHashes: ["tx-seed-transit", "tx-transit-subject"],
      amountPreservationRatio: 0.95,
      jobId: "job-1"
    });
    expect(completeForensicCheckJob.mock.calls[0][0].resultJson).toMatchObject({
      derivedLabel: {
        label: "darknet_exchange_proximity",
        assertionId: `derived_tron_darknet_exchange_proximity_${subject}`
      },
      coverageDebug: expect.objectContaining({
        subjectAddress: subject,
        summary: expect.objectContaining({
          directCounterpartyCount: expect.any(Number),
          historicalFallbackRequestedLimit: 150
        })
      })
    });
  });

  it("uses latest 150 historical transfers by default for sparse deep jobs below 150 window transfers", async () => {
    const calls: Array<{ address: string; hasWindow: boolean; limit?: number }> = [];
    const windowTransfers = Array.from({ length: 12 }, (_, index) =>
      transfer({
        id: `tx-window-${index}`,
        from: `TIn${index.toString().padStart(30, "0")}`,
        to: subject,
        amountRaw: "1000000000",
        at: "2026-05-20T10:00:00.000Z"
      })
    );
    const latestTransfers = [
      ...windowTransfers,
      transfer({
        id: "tx-historical-extra",
        from: "THistoricalExtra1111111111111111111",
        to: subject,
        amountRaw: "1000000000",
        at: "2026-04-01T10:00:00.000Z"
      })
    ];
    const completeForensicCheckJob = vi.fn(async (_input: Parameters<Parameters<typeof runSingleDeepForensicJobCycle>[0]["completeForensicCheckJob"]>[0]) => true);

    const handled = await runSingleDeepForensicJobCycle({
      claimNextForensicCheckJob: async () => job(),
      completeForensicCheckJob,
      recordRiskEvaluation: vi.fn(async () => undefined),
      tronClient: {
        listRelatedTrc20Transfers: async (address, options) => {
          calls.push({ address, hasWindow: Boolean(options?.minTimestamp), limit: options?.limit });
          if (address !== subject) return [];
          return options?.minTimestamp ? windowTransfers : latestTransfers;
        }
      },
      getLabelsForAddress: async () => [],
      getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({ subjectAddress: address })
    }, {
      pageLimit: 20,
      maxPagesPerAddress: 1,
      maxExpandedIntermediates: 0,
      metadataFetchLimit: 0,
      contractProfileFetchLimit: 0,
      maxInboundSenders: 0
    });

    expect(handled).toBe(true);
    expect(calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ address: subject, hasWindow: false, limit: 150 })
    ]));
    expect(completeForensicCheckJob.mock.calls[0][0].resultJson.coverageDebug).toMatchObject({
      summary: expect.objectContaining({
        thirtyDayTransferCount: 12,
        historicalFallbackTransferCount: 13,
        historicalFallbackRequestedLimit: 150
      })
    });
  });

  it("persists a system-derived marker for meaningful direct exposure to a high-risk counterparty", async () => {
    const transfersByAddress = new Map<string, RawTronscanTrc20Transfer[]>([
      [
        subject,
        [
          transfer({
            id: "tx-subject-counterparty",
            from: subject,
            to: seed,
            amountRaw: "120000000000",
            at: "2026-05-20T10:00:00.000Z"
          })
        ]
      ]
    ]);
    const upsertAddressLabelAssertion = vi.fn(async (_input: AddressLabelAssertionInput) => undefined);
    const completeForensicCheckJob = vi.fn(async (_input: Parameters<Parameters<typeof runSingleDeepForensicJobCycle>[0]["completeForensicCheckJob"]>[0]) => true);

    const handled = await runSingleDeepForensicJobCycle({
      claimNextForensicCheckJob: async () => job(),
      completeForensicCheckJob,
      recordRiskEvaluation: vi.fn(async () => undefined),
      upsertAddressLabelAssertion,
      tronClient: {
        listRelatedTrc20Transfers: async (address) => transfersByAddress.get(address) ?? []
      },
      getLabelsForAddress: async (address) => address === seed ? [darknetExchangeProximityLabel(address)] : [],
      getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({ subjectAddress: address })
    }, {
      pageLimit: 10,
      maxPagesPerAddress: 1,
      maxExpandedIntermediates: 0,
      metadataFetchLimit: 0,
      contractProfileFetchLimit: 0,
      maxInboundSenders: 1
    });

    expect(handled).toBe(true);
    expect(upsertAddressLabelAssertion).toHaveBeenCalledWith(expect.objectContaining({
      id: `derived_tron_darknet_exchange_proximity_${subject}`,
      address: subject,
      label: "darknet_exchange_proximity",
      sourceName: "forensic_route_search",
      derivedLabelSource: "system"
    }));
    expect(upsertAddressLabelAssertion.mock.calls[0][0].evidenceJson).toMatchObject({
      subjectAddress: subject,
      counterpartyAddress: seed,
      counterpartyLabel: "darknet_exchange_proximity",
      direction: "outbound",
      txHashes: ["tx-subject-counterparty"],
      amountRaw: "120000000000",
      volumeRatio: 1,
      jobId: "job-1"
    });
    expect(completeForensicCheckJob.mock.calls[0][0].resultJson).toMatchObject({
      derivedLabel: {
        label: "darknet_exchange_proximity",
        assertionId: `derived_tron_darknet_exchange_proximity_${subject}`
      }
    });
  });

  it("persists a system-derived approval-drain proximity marker from exact transferFrom provenance", async () => {
    const transfersByAddress = new Map<string, RawTronscanTrc20Transfer[]>([
      [
        subject,
        [
          transfer({
            id: "tx-receiver-subject",
            from: transit,
            to: subject,
            amountRaw: "309000000000",
            at: "2026-05-20T10:05:00.000Z"
          })
        ]
      ],
      [
        transit,
        [
          transfer({
            id: "tx-drain",
            from: victim,
            to: transit,
            amountRaw: "311851000000",
            at: "2026-05-20T10:00:00.000Z",
            triggerInfo: { methodName: "transferFrom", methodId: "23b872dd" }
          }),
          transfer({
            id: "tx-receiver-subject",
            from: transit,
            to: subject,
            amountRaw: "309000000000",
            at: "2026-05-20T10:05:00.000Z"
          })
        ]
      ]
    ]);
    const upsertAddressLabelAssertion = vi.fn(async (_input: AddressLabelAssertionInput) => undefined);
    const completeForensicCheckJob = vi.fn(async (_input: Parameters<Parameters<typeof runSingleDeepForensicJobCycle>[0]["completeForensicCheckJob"]>[0]) => true);

    const handled = await runSingleDeepForensicJobCycle({
      claimNextForensicCheckJob: async () => job(),
      completeForensicCheckJob,
      recordRiskEvaluation: vi.fn(async () => undefined),
      upsertAddressLabelAssertion,
      tronClient: {
        listRelatedTrc20Transfers: async (address) => transfersByAddress.get(address) ?? []
      },
      getLabelsForAddress: async () => [],
      getTransaction: async (txHash) => txHash === "tx-drain" ? { ownerAddress: spender } : {},
      listTrc20ApprovalChanges: async () => [approval()],
      getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({ subjectAddress: address })
    }, {
      pageLimit: 10,
      maxPagesPerAddress: 1,
      maxExpandedIntermediates: 0,
      metadataFetchLimit: 0,
      contractProfileFetchLimit: 0,
      maxInboundSenders: 1,
      maxApprovalDrainCandidates: 5,
      approvalChangeLookupLimit: 5
    });

    expect(handled).toBe(true);
    expect(upsertAddressLabelAssertion).toHaveBeenCalledWith(expect.objectContaining({
      id: `derived_tron_approval_drain_proximity_${subject}`,
      chain: "tron",
      address: subject,
      label: "approval_drain_proximity",
      category: "approval_drain_proximity",
      confidence: "high",
      severity: "high",
      status: "active",
      sourceName: "forensic_route_search",
      createdByTelegramId: null,
      derivedLabelSource: "system"
    }));
    expect(upsertAddressLabelAssertion.mock.calls[0][0].evidenceJson).toMatchObject({
      subjectAddress: subject,
      victimAddress: victim,
      spenderAddress: spender,
      firstReceiverAddress: transit,
      hopDepth: 1,
      approvalTxHash: "tx-approval",
      drainTxHash: "tx-drain",
      pathTxHashes: ["tx-drain", "tx-receiver-subject"],
      pathAddresses: [victim, transit, subject],
      amountRaw: "309000000000",
      score: 80,
      evidenceStrength: "route_linked",
      jobId: "job-1"
    });
    expect(completeForensicCheckJob.mock.calls[0][0].resultJson).toMatchObject({
      approvalDrainProvenanceProfiles: [
        expect.objectContaining({
          score: 80,
          approvalTxHash: "tx-approval",
          drainTxHash: "tx-drain"
        })
      ],
      derivedLabel: {
        label: "approval_drain_proximity",
        assertionId: `derived_tron_approval_drain_proximity_${subject}`
      }
    });
  });

  it("carries exact USDT blacklist state into deep job evidence and result JSON", async () => {
    const transfersByAddress = new Map<string, RawTronscanTrc20Transfer[]>([
      [
        subject,
        [
          transfer({
            id: "tx-benign",
            from: "TOther1111111111111111111111111111111",
            to: subject,
            amountRaw: "1000000000",
            at: "2026-05-20T10:00:00.000Z"
          })
        ]
      ]
    ]);
    const completeForensicCheckJob = vi.fn(async (_input: Parameters<Parameters<typeof runSingleDeepForensicJobCycle>[0]["completeForensicCheckJob"]>[0]) => true);
    const recordedEvaluations: Array<{ observations: unknown[] }> = [];
    const sentReports: DeepAddressForensicReport[] = [];
    const recordRiskEvaluation = vi.fn(async (input: { rawEvidence: unknown[]; observations: unknown[] }) => {
      recordedEvaluations.push(input);
    });
    const sendJobResult = vi.fn(async (_job: ForensicCheckJob, report: DeepAddressForensicReport) => {
      sentReports.push(report);
    });

    const handled = await runSingleDeepForensicJobCycle({
      claimNextForensicCheckJob: async () => job(),
      completeForensicCheckJob,
      recordRiskEvaluation,
      upsertAddressLabelAssertion: vi.fn(async (_input: AddressLabelAssertionInput) => undefined),
      tronClient: {
        listRelatedTrc20Transfers: async (address) => transfersByAddress.get(address) ?? []
      },
      getLabelsForAddress: async () => [],
      getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({
        subjectAddress: address,
        isBlacklisted: true,
        balanceRaw: "2642746070000",
        blacklistEventTxHash: "tx-blacklist"
      }),
      sendJobResult
    }, {
      pageLimit: 10,
      maxPagesPerAddress: 1,
      maxExpandedIntermediates: 0,
      metadataFetchLimit: 0,
      contractProfileFetchLimit: 0,
      maxInboundSenders: 1
    });

    expect(handled).toBe(true);
    expect(recordedEvaluations[0]?.observations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "stablecoin_usdt_blacklisted",
        scoreImpact: 90,
        severity: "critical"
      })
    ]));
    expect(completeForensicCheckJob.mock.calls[0][0].resultJson).toMatchObject({
      stablecoinRestrictionProfiles: [
        expect.objectContaining({
          subjectAddress: subject,
          isBlacklisted: true,
          balanceRaw: "2642746070000",
          blacklistEventTxHash: "tx-blacklist"
        })
      ]
    });
    expect(sentReports[0]?.stablecoinRestrictionProfiles).toEqual([
      expect.objectContaining({
        isBlacklisted: true
      })
    ]);
  });

  it("keeps a completed deep job completed when Telegram result delivery fails", async () => {
    const transfersByAddress = new Map<string, RawTronscanTrc20Transfer[]>([
      [
        subject,
        [
          transfer({
            id: "tx-benign-delivery",
            from: "TOther1111111111111111111111111111111",
            to: subject,
            amountRaw: "1000000000",
            at: "2026-05-20T10:00:00.000Z"
          })
        ]
      ]
    ]);
    const completeForensicCheckJob = vi.fn(async (_input: Parameters<Parameters<typeof runSingleDeepForensicJobCycle>[0]["completeForensicCheckJob"]>[0]) => true);
    const sendJobResult = vi.fn(async () => {
      throw new Error("Network request for 'sendMessage' failed!");
    });
    const sendJobFailure = vi.fn(async () => undefined);
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };

    const handled = await runSingleDeepForensicJobCycle({
      claimNextForensicCheckJob: async () => job(),
      completeForensicCheckJob,
      recordRiskEvaluation: vi.fn(async () => undefined),
      upsertAddressLabelAssertion: vi.fn(async (_input: AddressLabelAssertionInput) => undefined),
      tronClient: {
        listRelatedTrc20Transfers: async (address) => transfersByAddress.get(address) ?? []
      },
      getLabelsForAddress: async () => [],
      getUsdtRestrictionStatus: async (address) => usdtRestrictionProfile({ subjectAddress: address }),
      sendJobResult,
      sendJobFailure,
      logger
    }, {
      pageLimit: 10,
      maxPagesPerAddress: 1,
      maxExpandedIntermediates: 0,
      metadataFetchLimit: 0,
      contractProfileFetchLimit: 0,
      maxInboundSenders: 1
    });

    expect(handled).toBe(true);
    expect(sendJobResult).toHaveBeenCalledTimes(1);
    expect(sendJobFailure).not.toHaveBeenCalled();
    expect(completeForensicCheckJob).toHaveBeenCalledTimes(1);
    expect(completeForensicCheckJob.mock.calls[0][0]).toMatchObject({
      id: "job-1",
      lastError: null
    });
    expect(completeForensicCheckJob.mock.calls[0][0].status).not.toBe("failed");
    expect(logger.error).toHaveBeenCalledWith("deep_forensic_job_result_delivery_failed", expect.objectContaining({
      job_id: "job-1",
      subject_address: subject,
      chat_id: "42",
      error: "Network request for 'sendMessage' failed!"
    }));
  });
});
