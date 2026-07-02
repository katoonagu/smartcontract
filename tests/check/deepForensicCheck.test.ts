import { describe, expect, it } from "vitest";
import { runDeepAddressForensicCheck } from "../../src/check/deepForensicCheck";
import { TRON_USDT_CONTRACT_ADDRESS, type RawTronscanTrc20Transfer } from "../../src/parser/transactionParser";
import type {
  AddressLabel,
  IndexedTronUsdtTransfer,
  StablecoinRestrictionProfile,
  TronAddressUsdtIndexState
} from "../../src/types";
import type { TronscanApprovalChange } from "../../src/tron/tronClient";

const subject = "TSubject111111111111111111111111111111";
const transit = "TTransit111111111111111111111111111111";
const risky = "TRisky1111111111111111111111111111111";
const victim = "TVictim111111111111111111111111111111";
const spender = "TSpender11111111111111111111111111111";
const protocol = "TProtocol111111111111111111111111111";
const wrappedToken = "TWrappedToken1111111111111111111111";

function transfer(input: {
  id: string;
  from: string;
  to: string;
  amountRaw: string;
  at: string;
  contractAddress?: string;
  tokenInfo?: RawTronscanTrc20Transfer["tokenInfo"];
  riskTransaction?: boolean;
  toAddressIsContract?: boolean;
  triggerInfo?: unknown;
}): RawTronscanTrc20Transfer {
  return {
    transaction_id: input.id,
    from_address: input.from,
    to_address: input.to,
    quant: input.amountRaw,
    contract_address: input.contractAddress ?? TRON_USDT_CONTRACT_ADDRESS,
    confirmed: true,
    contractRet: "SUCCESS",
    block_ts: Date.parse(input.at),
    riskTransaction: input.riskTransaction,
    toAddressIsContract: input.toAddressIsContract,
    tokenInfo: input.tokenInfo,
    trigger_info: input.triggerInfo
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

function usdtRestriction(address: string, balanceRaw = "0"): StablecoinRestrictionProfile {
  return {
    subjectAddress: address,
    tokenContract: TRON_USDT_CONTRACT_ADDRESS,
    tokenSymbol: "USDT",
    tokenStandard: "TRC20",
    decimals: 6,
    isBlacklisted: false,
    balanceRaw,
    checkedAt: "2026-05-20T10:00:00.000Z",
    evidenceStrength: "exact_contract_state",
    blacklistEventTxHash: null,
    blacklistEventTimestamp: null,
    blacklistEventBlock: null,
    methods: {
      blacklist: "isBlackListed(address)",
      balance: "balanceOf(address)"
    }
  };
}

function completeIndexState(
  address: string,
  fetchedTransferCount: number,
  uniqueCounterpartyCount: number
): TronAddressUsdtIndexState {
  return {
    address,
    tokenContract: TRON_USDT_CONTRACT_ADDRESS,
    coverageMode: "all_time",
    coverageKind: "provider_windowed",
    targetTimestamp: null,
    status: "complete",
    statusReason: "complete_provider_windowed",
    provider: "tronscan",
    totalReported: null,
    fetchedTransferCount,
    uniqueCounterpartyCount,
    newestTransferAt: new Date("2026-07-01T00:00:00.000Z"),
    oldestTransferAt: new Date("2026-01-01T00:00:00.000Z"),
    coveredUntilTimestamp: new Date("2026-01-01T00:00:00.000Z"),
    fetchedPageCount: 1,
    plannedPageCount: null,
    currentEndTimestamp: null,
    providerCapHit: false,
    budgetExhausted: false,
    providerInconsistent: false,
    priority: 100,
    nextRunAt: new Date("2026-07-02T00:00:00.000Z"),
    attemptCount: 1,
    maxAttempts: 5,
    retryCount: 0,
    lastError: null,
    lastErrorClass: null,
    lastSuccessfulPageAt: new Date("2026-07-02T00:00:00.000Z"),
    queuedReason: "deep_subject",
    requestedByJobId: "job-1",
    lockedAt: null,
    lockedUntil: null,
    heartbeatAt: null,
    lockOwner: null,
    budgetPages: null,
    budgetSeconds: null,
    completedAt: new Date("2026-07-02T00:00:00.000Z"),
    createdAt: new Date("2026-07-02T00:00:00.000Z"),
    updatedAt: new Date("2026-07-02T00:00:00.000Z")
  };
}

function queuedIndexState(address: string): TronAddressUsdtIndexState {
  return {
    ...completeIndexState(address, 0, 0),
    status: "queued",
    statusReason: null,
    fetchedTransferCount: 0,
    uniqueCounterpartyCount: 0,
    fetchedPageCount: 0,
    completedAt: null
  };
}

function label(address: string): AddressLabel {
  return {
    address,
    label: "phishing",
    source: "service_admin",
    createdByTelegramId: "1",
    createdAt: new Date("2026-05-01T00:00:00.000Z")
  };
}

function darknetLabel(address: string): AddressLabel {
  return {
    address,
    label: "darknet_exchange" as any,
    source: "service_admin",
    createdByTelegramId: "1",
    createdAt: new Date("2026-05-01T00:00:00.000Z")
  };
}

function proximityLabel(address: string): AddressLabel {
  return {
    address,
    label: "darknet_exchange_proximity" as any,
    source: "system",
    createdByTelegramId: null,
    createdAt: new Date("2026-05-01T00:00:00.000Z")
  };
}

function whitebitLabel(address: string): AddressLabel {
  return {
    address,
    label: "whitebit",
    source: "service_admin",
    createdByTelegramId: "1",
    createdAt: new Date("2026-05-01T00:00:00.000Z")
  };
}

function indexed(input: {
  id: string;
  from: string;
  to: string;
  amountRaw: string;
  at: string;
  eventIndex?: number;
}): IndexedTronUsdtTransfer {
  return {
    txHash: input.id,
    blockNumber: 100,
    blockTimestamp: new Date(input.at),
    eventIndex: input.eventIndex ?? 0,
    fromAddress: input.from,
    toAddress: input.to,
    amountRaw: input.amountRaw,
    method: "transfer",
    callerAddress: null,
    contractRet: "SUCCESS",
    confirmed: true
  };
}

describe("deep forensic address check", () => {
  it("uses the full all-time direct boundary instead of top incoming-sender cap", async () => {
    const sourceAddress = "TSubjectAllTime111111111111111111111";
    const transfers = Array.from({ length: 20 }, (_, index) =>
      indexed({
        id: `tx-all-time-${index}`,
        from: `TSender${String(index).padStart(2, "0")}111111111111111111111`,
        to: sourceAddress,
        amountRaw: String((index + 1) * 1_000_000),
        at: `2026-06-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
        eventIndex: index
      })
    );

    const report = await runDeepAddressForensicCheck({
      tronClient: { listRelatedTrc20Transfers: async () => [] },
      listIndexedUsdtTransfersForAddress: async (address, options) => {
        if (address !== sourceAddress) return [];
        return transfers.slice(options.offset ?? 0, (options.offset ?? 0) + options.limit);
      },
      getLabelsForAddress: async () => [],
      getAddressMetadata: async () => null,
      getContractIntelligenceProfile: async () => null,
      getUsdtRestrictionStatus: async (address) => usdtRestriction(address)
    }, {
      sourceAddress,
      windowStart: new Date(0),
      windowEnd: new Date("2026-07-02T00:00:00.000Z"),
      pageLimit: 50,
      maxPagesPerAddress: 3,
      maxInboundSenders: 1,
      allTimeSubjectIndexState: completeIndexState(sourceAddress, 20, 20),
      allTimeMode: "strict",
      secondLayerMaxActiveWalletsPerJob: 25
    });

    expect(report.coverage.allTime?.subjectUniqueDirectWallets).toBe(20);
    expect(report.coverage.allTime?.directWalletsHardEvidenceChecked).toBe(20);
    expect(report.directCounterpartyInteractionProfiles ?? []).toHaveLength(20);
  });

  it("bounds full all-time direct boundary reads by the indexed transfer count", async () => {
    const sourceAddress = "TSubjectAllTimeBounded111111111111";
    const transfers = Array.from({ length: 2 }, (_, index) =>
      indexed({
        id: `tx-bounded-${index}`,
        from: `TBoundedSender${index}111111111111111`,
        to: sourceAddress,
        amountRaw: "1000000",
        at: `2026-06-0${index + 1}T00:00:00.000Z`,
        eventIndex: index
      })
    );
    const reads: Array<{ offset?: number; limit: number }> = [];

    const report = await runDeepAddressForensicCheck({
      tronClient: { listRelatedTrc20Transfers: async () => [] },
      listIndexedUsdtTransfersForAddress: async (address, options) => {
        if (address !== sourceAddress) return [];
        reads.push({ offset: options.offset, limit: options.limit });
        return transfers.slice(0, options.limit);
      },
      getLabelsForAddress: async () => [],
      getAddressMetadata: async () => null,
      getContractIntelligenceProfile: async () => null,
      getUsdtRestrictionStatus: async (address) => usdtRestriction(address)
    }, {
      sourceAddress,
      windowStart: new Date(0),
      windowEnd: new Date("2026-07-02T00:00:00.000Z"),
      pageLimit: 50,
      maxPagesPerAddress: 3,
      maxInboundSenders: 1,
      extendedSearchMode: "disabled",
      allTimeSubjectIndexState: completeIndexState(sourceAddress, 2, 2),
      allTimeMode: "strict"
    });

    expect(reads.filter((read) => read.offset !== undefined)).toEqual([{ offset: 0, limit: 2 }]);
    expect(report.coverage.allTime?.subjectUniqueDirectWallets).toBe(2);
  });

  it("promotes all-time direct stablecoin blacklist evidence into interaction profiles", async () => {
    const sourceAddress = "TSubjectAllTimeBlacklist111111111111";
    const blacklistedCounterparty = "TBlacklistedDirect11111111111111111";
    const transfers = [indexed({
      id: "tx-all-time-blacklist",
      from: blacklistedCounterparty,
      to: sourceAddress,
      amountRaw: "1000000000",
      at: "2026-06-01T00:00:00.000Z"
    })];

    const report = await runDeepAddressForensicCheck({
      tronClient: { listRelatedTrc20Transfers: async () => [] },
      listIndexedUsdtTransfersForAddress: async (address, options) => {
        if (address !== sourceAddress) return [];
        return transfers.slice(options.offset ?? 0, (options.offset ?? 0) + options.limit);
      },
      getLabelsForAddress: async () => [],
      getAddressMetadata: async () => null,
      getContractIntelligenceProfile: async () => null,
      getUsdtRestrictionStatus: async (address) => ({
        ...usdtRestriction(address),
        isBlacklisted: address === blacklistedCounterparty,
        blacklistEventTxHash: address === blacklistedCounterparty ? "tx-blacklist" : null,
        blacklistEventTimestamp: address === blacklistedCounterparty ? "2026-06-01T00:00:00.000Z" : null,
        blacklistEventBlock: address === blacklistedCounterparty ? 100 : null
      })
    }, {
      sourceAddress,
      windowStart: new Date(0),
      windowEnd: new Date("2026-07-02T00:00:00.000Z"),
      pageLimit: 50,
      maxPagesPerAddress: 3,
      maxInboundSenders: 1,
      allTimeSubjectIndexState: completeIndexState(sourceAddress, 1, 1),
      allTimeMode: "strict"
    });

    expect(report.coverage.allTime?.directHardEvidenceStatus).toBe("complete");
    expect(report.directCounterpartyInteractionProfiles?.[0]).toMatchObject({
      counterpartyAddress: blacklistedCounterparty,
      evidenceClass: "exact_labeled_counterparty",
      snapshot: expect.objectContaining({
        source: "stablecoin_blacklist",
        riskLevel: "CRITICAL"
      })
    });
    expect(report.directCounterpartyInteractionProfiles?.[0]?.scoreContribution).toBeGreaterThan(0);
  });

  it("reports incomplete all-time direct hard evidence when live blacklist lookup fails", async () => {
    const sourceAddress = "TSubjectAllTimeLiveFailure11111111";
    const directCounterparty = "TLiveFailureDirect111111111111111";
    const transfers = [indexed({
      id: "tx-live-failure",
      from: directCounterparty,
      to: sourceAddress,
      amountRaw: "1000000000",
      at: "2026-06-01T00:00:00.000Z"
    })];

    const report = await runDeepAddressForensicCheck({
      tronClient: { listRelatedTrc20Transfers: async () => [] },
      listIndexedUsdtTransfersForAddress: async (address, options) => {
        if (address !== sourceAddress) return [];
        return transfers.slice(options.offset ?? 0, (options.offset ?? 0) + options.limit);
      },
      getLabelsForAddress: async () => [],
      getAddressMetadata: async () => null,
      getContractIntelligenceProfile: async () => null,
      getUsdtRestrictionStatus: async () => {
        throw new Error("429");
      }
    }, {
      sourceAddress,
      windowStart: new Date(0),
      windowEnd: new Date("2026-07-02T00:00:00.000Z"),
      pageLimit: 50,
      maxPagesPerAddress: 3,
      maxInboundSenders: 1,
      allTimeSubjectIndexState: completeIndexState(sourceAddress, 1, 1),
      allTimeMode: "strict"
    });

    expect(report.coverage.allTime?.directHardEvidenceStatus).toBe("local_only_partial");
    expect(report.coverage.allTime?.directWalletsHardEvidenceLiveChecked).toBe(0);
    expect(report.missingChecks).toEqual(expect.arrayContaining([
      expect.stringContaining("Direct hard evidence USDT blacklist lookup incomplete")
    ]));
  });

  it("keeps bounded fast snapshots when the all-time subject index is incomplete", async () => {
    const sourceAddress = "TSubjectPartialIndex1111111111111111";
    const blacklistedCounterparty = "TPartialBlacklisted1111111111111111";

    const report = await runDeepAddressForensicCheck({
      tronClient: {
        listRelatedTrc20Transfers: async (address) =>
          address === sourceAddress
            ? [transfer({
              id: "tx-partial-blacklist",
              from: blacklistedCounterparty,
              to: sourceAddress,
              amountRaw: "1000000000",
              at: "2026-06-01T00:00:00.000Z"
            })]
            : []
      },
      listIndexedUsdtTransfersForAddress: async () => [],
      getLabelsForAddress: async () => [],
      getAddressMetadata: async () => null,
      getContractIntelligenceProfile: async () => null,
      getUsdtRestrictionStatus: async (address) => ({
        ...usdtRestriction(address),
        isBlacklisted: address === blacklistedCounterparty
      })
    }, {
      sourceAddress,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-07-02T00:00:00.000Z"),
      pageLimit: 50,
      maxPagesPerAddress: 1,
      maxInboundSenders: 1,
      extendedSearchMode: "disabled",
      allTimeSubjectIndexState: queuedIndexState(sourceAddress),
      allTimeMode: "partial"
    });

    expect(report.coverage.allTime?.subjectAllTimeComplete).toBe(false);
    expect(report.coverage.allTime?.subjectUniqueDirectWallets).toBe(0);
    expect(report.directCounterpartyInteractionProfiles?.[0]).toMatchObject({
      counterpartyAddress: blacklistedCounterparty,
      snapshot: expect.objectContaining({ source: "stablecoin_blacklist" })
    });
  });

  it("does not materialize huge complete all-time subject indexes in memory", async () => {
    let indexedReads = 0;

    const report = await runDeepAddressForensicCheck({
      tronClient: {
        listRelatedTrc20Transfers: async (address) =>
          address === subject
            ? [transfer({ id: "tx-local-subject", from: transit, to: subject, amountRaw: "1000000", at: "2026-06-01T00:00:00.000Z" })]
            : []
      },
      listIndexedUsdtTransfersForAddress: async (_address, options) => {
        if (options.limit === 1000 && options.offset !== undefined && options.minTimestamp.getTime() === 0) {
          indexedReads += 1;
          throw new Error("must not page huge all-time subject history");
        }
        return [];
      },
      getLabelsForAddress: async () => []
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-07-02T00:00:00.000Z"),
      pageLimit: 10,
      maxPagesPerAddress: 1,
      maxInboundSenders: 1,
      extendedSearchMode: "disabled",
      allTimeSubjectIndexState: completeIndexState(subject, 50_001, 10),
      allTimeMode: "strict"
    });

    expect(indexedReads).toBe(0);
    expect(report.coverage.allTime?.subjectAllTimeComplete).toBe(false);
    expect(report.coverage.allTime?.subjectTransfersFetched).toBe(50_001);
    expect(report.missingChecks).toEqual(expect.arrayContaining([
      expect.stringContaining("All-time subject index has 50001 transfers")
    ]));
  });

  it("includes run profile and provider budget state in the report", async () => {
    const report = await runDeepAddressForensicCheck({
      tronClient: {
        listRelatedTrc20Transfers: async () => []
      },
      getLabelsForAddress: async () => []
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      pageLimit: 10,
      maxPagesPerAddress: 1,
      maxExpandedIntermediates: 0,
      metadataFetchLimit: 0,
      contractProfileFetchLimit: 0,
      maxInboundSenders: 0,
      runProfile: "bounded_rerun",
      providerCallBudget: 20,
      transferCallBudget: 10,
      contractCallBudget: 0,
      approvalCallBudget: 0,
      elapsedTimeBudgetMs: 30000
    });

    expect(report.runProfile).toBe("bounded_rerun");
    expect(report.providerBudget).toEqual({
      providerCallBudget: 20,
      transferCallBudget: 10,
      contractCallBudget: 0,
      approvalCallBudget: 0,
      elapsedTimeBudgetMs: 30000,
      exhausted: false
    });
  });

  it("returns a partial report when provider transfer lookup is aborted", async () => {
    const report = await runDeepAddressForensicCheck({
      tronClient: {
        listRelatedTrc20Transfers: async () => {
          throw new Error("This operation was aborted");
        }
      },
      getLabelsForAddress: async () => []
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      pageLimit: 10,
      maxPagesPerAddress: 1,
      maxExpandedIntermediates: 0,
      metadataFetchLimit: 0,
      contractProfileFetchLimit: 0,
      maxInboundSenders: 0
    });

    expect(report.missingChecks).toEqual(expect.arrayContaining([
      expect.stringContaining("This operation was aborted")
    ]));
    expect(report.coverage.sourceTransferPages).toBe(0);
  });

  it("adds extended local-index provenance candidates without relying on TronScan traversal", async () => {
    const hop2 = "THop22222222222222222222222222222222";
    const hop3 = "THop33333333333333333333333333333333";
    const transfersByAddress = new Map<string, RawTronscanTrc20Transfer[]>([
      [
        subject,
        [
          transfer({ id: "tx-transit-subject", from: transit, to: subject, amountRaw: "97000000000", at: "2026-05-20T10:00:00.000Z" })
        ]
      ]
    ]);
    const indexedByAddress = new Map<string, IndexedTronUsdtTransfer[]>([
      [subject, [indexed({ id: "tx-transit-subject", from: transit, to: subject, amountRaw: "97000000000", at: "2026-05-20T10:00:00.000Z" })]],
      [transit, [indexed({ id: "tx-hop2-transit", from: hop2, to: transit, amountRaw: "98000000000", at: "2026-05-20T09:55:00.000Z" })]],
      [hop2, [indexed({ id: "tx-hop3-hop2", from: hop3, to: hop2, amountRaw: "99000000000", at: "2026-05-20T09:50:00.000Z" })]],
      [hop3, [indexed({ id: "tx-risky-hop3", from: risky, to: hop3, amountRaw: "100000000000", at: "2026-05-20T09:45:00.000Z" })]]
    ]);

    const report = await runDeepAddressForensicCheck({
      tronClient: {
        listRelatedTrc20Transfers: async (address) => transfersByAddress.get(address) ?? []
      },
      getLabelsForAddress: async (address) => address === risky ? [darknetLabel(address)] : [],
      listIndexedUsdtTransfersForAddress: async (address) => indexedByAddress.get(address) ?? []
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      pageLimit: 10,
      maxPagesPerAddress: 1,
      maxExpandedIntermediates: 0,
      metadataFetchLimit: 0,
      contractProfileFetchLimit: 0,
      maxInboundSenders: 0,
      extendedSearchMode: "always",
      extendedSearchMaxDepth: 4
    });

    const extended = report.extendedProvenanceProfiles?.[0];
    const exactPath = extended?.paths.find((path) => path.evidenceStrength === "exact_labeled_path");
    expect(extended).toMatchObject({ direction: "inbound", score: expect.any(Number) });
    expect(exactPath).toMatchObject({
      depth: 4,
      label: "darknet_exchange",
      evidenceStrength: "exact_labeled_path"
    });
    expect(report.rawEvidence.some((evidence) => "extendedProvenanceProfile" in evidence.evidenceJson)).toBe(true);
    expect(report.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "forensic_extended_provenance",
          source: "local_tron_usdt_index"
        })
      ])
    );
  });

  it("adds inbound provenance evidence and observation for a preserved two-hop source", async () => {
    const transfersByAddress = new Map<string, RawTronscanTrc20Transfer[]>([
      [
        subject,
        [
          transfer({ id: "tx-transit-subject", from: transit, to: subject, amountRaw: "95000000000", at: "2026-05-20T10:00:00.000Z" })
        ]
      ],
      [
        transit,
        [
          transfer({ id: "tx-risky-transit", from: risky, to: transit, amountRaw: "100000000000", at: "2026-05-20T09:55:00.000Z" }),
          transfer({ id: "tx-transit-subject", from: transit, to: subject, amountRaw: "95000000000", at: "2026-05-20T10:00:00.000Z" })
        ]
      ]
    ]);

    const report = await runDeepAddressForensicCheck({
      tronClient: {
        listRelatedTrc20Transfers: async (address) => transfersByAddress.get(address) ?? []
      },
      getLabelsForAddress: async (address) => address === risky ? [label(address)] : []
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      pageLimit: 10,
      maxPagesPerAddress: 1,
      maxExpandedIntermediates: 0,
      metadataFetchLimit: 0,
      contractProfileFetchLimit: 0,
      maxInboundSenders: 1
    });

    expect(report.inboundProvenanceProfiles[0]).toMatchObject({
      subjectAddress: subject,
      score: 30,
      paths: [
        expect.objectContaining({
          depth: 2,
          sourceAddress: risky,
          viaAddresses: [transit],
          amountPreservationRatio: 0.95
        })
      ]
    });
    expect(report.rawEvidence.some((evidence) => "inboundProvenanceProfile" in evidence.evidenceJson)).toBe(true);
    expect(report.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "forensic_inbound_provenance",
          signalGroup: "incoming_context",
          scoreImpact: 30
        })
      ])
    );
  });

  it("uses darknet exchange provenance observation and higher impact for preserved two-hop seed exposure", async () => {
    const transfersByAddress = new Map<string, RawTronscanTrc20Transfer[]>([
      [
        subject,
        [
          transfer({ id: "tx-transit-subject", from: transit, to: subject, amountRaw: "95000000000", at: "2026-05-20T10:00:00.000Z" })
        ]
      ],
      [
        transit,
        [
          transfer({ id: "tx-risky-transit", from: risky, to: transit, amountRaw: "100000000000", at: "2026-05-20T09:55:00.000Z" }),
          transfer({ id: "tx-transit-subject", from: transit, to: subject, amountRaw: "95000000000", at: "2026-05-20T10:00:00.000Z" })
        ]
      ]
    ]);

    const report = await runDeepAddressForensicCheck({
      tronClient: {
        listRelatedTrc20Transfers: async (address) => transfersByAddress.get(address) ?? []
      },
      getLabelsForAddress: async (address) => address === risky ? [darknetLabel(address)] : []
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      pageLimit: 10,
      maxPagesPerAddress: 1,
      maxExpandedIntermediates: 0,
      metadataFetchLimit: 0,
      contractProfileFetchLimit: 0,
      maxInboundSenders: 1
    });

    expect(report.inboundProvenanceProfiles[0]).toMatchObject({
      score: 45,
      paths: [
        expect.objectContaining({
          depth: 2,
          label: "darknet_exchange",
          sourceAddress: risky,
          viaAddresses: [transit]
        })
      ]
    });
    expect(report.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "forensic_darknet_exchange_provenance",
          signalGroup: "incoming_context",
          scoreImpact: 45,
          message: "Confirmed on-chain exposure to known darknet exchange seed within 2 hops."
        })
      ])
    );
  });

  it("adds a high-risk counterparty profile for meaningful outbound exposure to a derived darknet proximity marker", async () => {
    const transfersByAddress = new Map<string, RawTronscanTrc20Transfer[]>([
      [
        subject,
        [
          transfer({ id: "tx-subject-risky", from: subject, to: risky, amountRaw: "100000000000", at: "2026-05-20T10:00:00.000Z" })
        ]
      ]
    ]);

    const report = await runDeepAddressForensicCheck({
      tronClient: {
        listRelatedTrc20Transfers: async (address) => transfersByAddress.get(address) ?? []
      },
      getLabelsForAddress: async (address) => address === risky ? [proximityLabel(address)] : []
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      pageLimit: 10,
      maxPagesPerAddress: 1,
      maxExpandedIntermediates: 0,
      metadataFetchLimit: 0,
      contractProfileFetchLimit: 0,
      maxInboundSenders: 1
    });

    expect(report.counterpartyRiskProfiles).toEqual([
      expect.objectContaining({
        subjectAddress: subject,
        direction: "outbound",
        counterpartyAddress: risky,
        label: "darknet_exchange_proximity",
        amountRaw: "100000000000",
        txCount: 1,
        volumeRatio: 1,
        score: 80,
        txHashes: ["tx-subject-risky"]
      })
    ]);
    expect(report.rawEvidence.some((evidence) => "counterpartyRiskProfile" in evidence.evidenceJson)).toBe(true);
    expect(report.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "forensic_counterparty_darknet_exchange_proximity",
          signalGroup: "incoming_context",
          scoreImpact: 80,
          message: "Direct counterparty has a confirmed darknet exchange proximity marker."
        })
      ])
    );
  });

  it("adds a high-risk counterparty profile for meaningful exposure to a WhiteBIT label", async () => {
    const transfersByAddress = new Map<string, RawTronscanTrc20Transfer[]>([
      [
        subject,
        [
          transfer({ id: "tx-subject-whitebit", from: subject, to: risky, amountRaw: "100000000000", at: "2026-05-20T10:00:00.000Z" })
        ]
      ]
    ]);

    const report = await runDeepAddressForensicCheck({
      tronClient: {
        listRelatedTrc20Transfers: async (address) => transfersByAddress.get(address) ?? []
      },
      getLabelsForAddress: async (address) => address === risky ? [whitebitLabel(address)] : []
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      pageLimit: 10,
      maxPagesPerAddress: 1,
      maxExpandedIntermediates: 0,
      metadataFetchLimit: 0,
      contractProfileFetchLimit: 0,
      maxInboundSenders: 0
    });

    expect(report.counterpartyRiskProfiles[0]).toMatchObject({
      subjectAddress: subject,
      direction: "outbound",
      counterpartyAddress: risky,
      label: "whitebit",
      score: 80,
      features: [
        expect.objectContaining({
          code: "counterparty_direct_whitebit",
          label: "Direct counterparty is labeled WhiteBIT high-risk source."
        })
      ]
    });
    expect(report.observations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "forensic_counterparty_whitebit",
        signalGroup: "incoming_context",
        scoreImpact: 80,
        message: "Direct counterparty is labeled WhiteBIT high-risk source."
      })
    ]));
  });

  it("does not score dust exposure to a risky counterparty below meaningful thresholds", async () => {
    const transfersByAddress = new Map<string, RawTronscanTrc20Transfer[]>([
      [
        subject,
        [
          transfer({ id: "tx-subject-risky-dust", from: subject, to: risky, amountRaw: "20000000", at: "2026-05-20T10:00:00.000Z" }),
          transfer({ id: "tx-subject-normal", from: subject, to: transit, amountRaw: "1000000000000", at: "2026-05-20T10:05:00.000Z" })
        ]
      ]
    ]);

    const report = await runDeepAddressForensicCheck({
      tronClient: {
        listRelatedTrc20Transfers: async (address) => transfersByAddress.get(address) ?? []
      },
      getLabelsForAddress: async (address) => address === risky ? [proximityLabel(address)] : []
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      pageLimit: 10,
      maxPagesPerAddress: 1,
      maxExpandedIntermediates: 0,
      metadataFetchLimit: 0,
      contractProfileFetchLimit: 0,
      maxInboundSenders: 1
    });

    expect(report.counterpartyRiskProfiles.filter((profile) => profile.score > 0)).toEqual([]);
    expect(report.observations.some((observation) => observation.code === "forensic_counterparty_darknet_exchange_proximity")).toBe(false);
  });

  it("scores a dominant direct counterparty by bounded fast forensic snapshot without creating exact taint", async () => {
    const service = "TService11111111111111111111111111111";
    const normal = "TNormal111111111111111111111111111111";
    const calls: string[] = [];
    const transfersByAddress = new Map<string, RawTronscanTrc20Transfer[]>([
      [
        subject,
        [
          transfer({ id: "tx-risky-subject-1", from: risky, to: subject, amountRaw: "700000000000", at: "2026-05-20T10:00:00.000Z" }),
          transfer({ id: "tx-risky-subject-2", from: risky, to: subject, amountRaw: "100000000000", at: "2026-05-20T10:02:00.000Z" }),
          transfer({ id: "tx-normal-subject", from: normal, to: subject, amountRaw: "200000000000", at: "2026-05-20T10:05:00.000Z" })
        ]
      ],
      [
        risky,
        [
          transfer({ id: "tx-seed-risky", from: transit, to: risky, amountRaw: "820000000000", at: "2026-05-20T09:50:00.000Z" }),
          transfer({ id: "tx-risky-service", from: risky, to: service, amountRaw: "800000000000", at: "2026-05-20T09:55:00.000Z" })
        ]
      ],
      [normal, []]
    ]);

    const report = await runDeepAddressForensicCheck({
      tronClient: {
        listRelatedTrc20Transfers: async (address) => {
          calls.push(address);
          return transfersByAddress.get(address) ?? [];
        }
      },
      getLabelsForAddress: async () => [],
      getAddressMetadata: async (address) => {
        if (address !== service) return null;
        return {
          address,
          source: "tronscan",
          name: "MetaRouter",
          tag: "router",
          isContract: true,
          verified: true,
          accountType: 2,
          rawJson: {},
          fetchedAt: new Date("2026-05-20T10:00:00.000Z"),
          expiresAt: new Date("2026-05-21T10:00:00.000Z")
        };
      }
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      pageLimit: 10,
      maxPagesPerAddress: 1,
      maxExpandedIntermediates: 0,
      metadataFetchLimit: 4,
      contractProfileFetchLimit: 0,
      maxInboundSenders: 0,
      recentFallbackMinTransferCount: 60,
      recentFallbackTransferLimit: 60,
      counterpartyFastSnapshotLimit: 30
    });

    expect(calls).toContain(risky);
    expect(report.counterpartyRiskProfiles.filter((profile) => profile.score > 0)).toEqual([]);
    expect(report.directCounterpartyInteractionProfiles?.[0]).toMatchObject({
      counterpartyAddress: risky,
      direction: "inbound",
      volumeRatio: 0.8,
      scoreContribution: 65,
      evidenceClass: "counterparty_behavior_context",
      snapshot: expect.objectContaining({
        riskScore: expect.any(Number),
        riskLevel: "HIGH",
        source: "fast_address_check"
      })
    });
    expect(report.rawEvidence.some((evidence) => "directCounterpartyInteractionProfile" in evidence.evidenceJson)).toBe(true);
    expect(report.observations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "forensic_counterparty_fast_snapshot_context",
        scoreImpact: 65,
        message: "Major direct counterparty has high fast forensic risk; this is interaction context, not exact taint proof."
      })
    ]));
    expect(report.coverageDebug.rows[0]).toMatchObject({
      counterparty: risky,
      counterpartyRiskScore: expect.any(Number),
      riskSource: "fast_address_check",
      scoreContribution: 65
    });
  });

  it("rechecks a hinted lower-volume counterparty before a higher-volume unhinted active counterparty", async () => {
    const top = "TTop11111111111111111111111111111111";
    const hinted = "THinted1111111111111111111111111111";
    const calls: string[] = [];
    const restrictionCalls: string[] = [];
    const transfersByAddress = new Map<string, RawTronscanTrc20Transfer[]>([
      [
        subject,
        [
          transfer({ id: "tx-top-subject", from: top, to: subject, amountRaw: "900000000000", at: "2026-05-20T10:00:00.000Z" }),
          transfer({ id: "tx-hinted-subject", from: hinted, to: subject, amountRaw: "1000000000", at: "2026-05-20T10:05:00.000Z" })
        ]
      ],
      [top, []],
      [hinted, []]
    ]);

    await runDeepAddressForensicCheck({
      tronClient: {
        listRelatedTrc20Transfers: async (address) => {
          calls.push(address);
          return transfersByAddress.get(address) ?? [];
        }
      },
      getLabelsForAddress: async () => [],
      getUsdtRestrictionStatus: async (address) => {
        restrictionCalls.push(address);
        return usdtRestriction(address);
      }
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      pageLimit: 10,
      maxPagesPerAddress: 1,
      maxExpandedIntermediates: 0,
      metadataFetchLimit: 0,
      contractProfileFetchLimit: 0,
      maxInboundSenders: 0,
      recentFallbackMinTransferCount: 0,
      counterpartyFastSnapshotActiveLimit: 1,
      fastCheckHints: [{
        address: hinted,
        direction: "incoming",
        volumeRaw: "1000000000",
        txCount: 1,
        category: null,
        identity: "hint metadata must not score",
        reason: "top_fast_incoming_counterparty"
      }]
    });

    expect(calls).toContain(hinted);
    expect(calls).not.toContain(top);
    expect(restrictionCalls).toContain(hinted);
    expect(restrictionCalls).not.toContain(top);
  });

  it("does not turn hint metadata alone into evidence observations or score", async () => {
    const hinted = "THintOnly11111111111111111111111111";
    const calls: string[] = [];
    const report = await runDeepAddressForensicCheck({
      tronClient: {
        listRelatedTrc20Transfers: async (address) => {
          calls.push(address);
          return [];
        }
      },
      getLabelsForAddress: async () => []
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      pageLimit: 10,
      maxPagesPerAddress: 1,
      maxExpandedIntermediates: 0,
      metadataFetchLimit: 0,
      contractProfileFetchLimit: 0,
      maxInboundSenders: 0,
      counterpartyFastSnapshotActiveLimit: 1,
      fastCheckHints: [{
        address: hinted,
        direction: "incoming",
        volumeRaw: "999999999999",
        txCount: 99,
        category: "cex",
        identity: "Hinted Exchange",
        reason: "top_fast_incoming_counterparty"
      }]
    });

    expect(calls).not.toContain(hinted);
    expect(report.directCounterpartyInteractionProfiles).toEqual([]);
    expect(JSON.stringify(report.rawEvidence)).not.toContain(hinted);
    expect(JSON.stringify(report.observations)).not.toContain(hinted);
    expect(report.observations.some((observation) => observation.code === "forensic_counterparty_fast_snapshot_context")).toBe(false);
  });

  it("adds boundary exposure and wallet role evidence for deep checks", async () => {
    const service = "TService11111111111111111111111111111";
    const transfersByAddress = new Map<string, RawTronscanTrc20Transfer[]>([
      [
        subject,
        [
          transfer({ id: "tx-subject-service", from: subject, to: service, amountRaw: "311851000000", at: "2026-05-20T10:00:00.000Z" })
        ]
      ]
    ]);

    const report = await runDeepAddressForensicCheck({
      tronClient: {
        listRelatedTrc20Transfers: async (address) => transfersByAddress.get(address) ?? []
      },
      getLabelsForAddress: async () => [],
      getAddressMetadata: async (address) => {
        if (address === subject) {
          return {
            address,
            source: "tronscan",
            name: "Example CEX Hot Wallet",
            tag: "hot wallet",
            isContract: false,
            verified: true,
            accountType: 1,
            rawJson: {},
            fetchedAt: new Date("2026-05-20T10:00:00.000Z"),
            expiresAt: new Date("2026-05-21T10:00:00.000Z")
          };
        }
        if (address === service) {
          return {
            address,
            source: "tronscan",
            name: "Allbridge LP USDT Pool",
            tag: "Allbridge LP",
            isContract: true,
            verified: true,
            accountType: 2,
            rawJson: {},
            fetchedAt: new Date("2026-05-20T10:00:00.000Z"),
            expiresAt: new Date("2026-05-21T10:00:00.000Z")
          };
        }
        return null;
      }
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      pageLimit: 10,
      maxPagesPerAddress: 1,
      maxExpandedIntermediates: 0,
      metadataFetchLimit: 10,
      contractProfileFetchLimit: 0,
      maxInboundSenders: 0
    });

    expect(report.boundaryExposureProfiles[0]).toMatchObject({
      subjectAddress: subject,
      outgoingBoundaryVolumeRaw: "311851000000",
      contextScore: 15
    });
    expect(report.walletRoleProfiles[0]).toMatchObject({
      subjectAddress: subject,
      primaryRole: "cashout_service"
    });
    expect(report.rawEvidence.some((evidence) => "boundaryExposureProfile" in evidence.evidenceJson)).toBe(true);
    expect(report.rawEvidence.some((evidence) => "walletRoleProfile" in evidence.evidenceJson)).toBe(true);
    expect(report.observations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "forensic_boundary_exposure_context",
        message: "Funds touched service-boundary infrastructure; public-chain continuity after this point should not be assumed.",
        scoreImpact: 15
      }),
      expect.objectContaining({
        code: "forensic_wallet_role_context",
        message: "Wallet role context: cashout_service (high confidence).",
        scoreImpact: 0
      })
    ]));
  });

  it("builds operational flow from live source transfers when the local USDT index is empty", async () => {
    const service = "TService11111111111111111111111111111";
    const funder = "TFunder111111111111111111111111111111";
    const transfersByAddress = new Map<string, RawTronscanTrc20Transfer[]>([
      [
        subject,
        [
          transfer({ id: "tx-funder-subject", from: funder, to: subject, amountRaw: "1000000000000", at: "2026-05-20T10:00:00.000Z" }),
          transfer({ id: "tx-subject-service", from: subject, to: service, amountRaw: "950000000000", at: "2026-05-20T10:05:00.000Z" })
        ]
      ],
      [funder, []]
    ]);

    const report = await runDeepAddressForensicCheck({
      tronClient: {
        listRelatedTrc20Transfers: async (address) => transfersByAddress.get(address) ?? []
      },
      getLabelsForAddress: async () => [],
      getAddressMetadata: async (address) => {
        if (address === service) {
          return {
            address,
            source: "tronscan",
            name: "Allbridge LP USDT Pool",
            tag: "Allbridge LP",
            isContract: true,
            verified: true,
            accountType: 2,
            rawJson: {},
            fetchedAt: new Date("2026-05-20T10:00:00.000Z"),
            expiresAt: new Date("2026-05-21T10:00:00.000Z")
          };
        }
        return null;
      }
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      pageLimit: 10,
      maxPagesPerAddress: 1,
      maxExpandedIntermediates: 0,
      metadataFetchLimit: 10,
      contractProfileFetchLimit: 0,
      maxInboundSenders: 0
    });

    expect(report.operationalFlowProfiles?.[0]).toMatchObject({
      subjectAddress: subject,
      incomingVolumeRaw: "1000000000000",
      outgoingVolumeRaw: "950000000000",
      incomingTxCount: 1,
      outgoingTxCount: 1,
      bridgeDexRouterOutgoingRatio: 1,
      historicalTransitScore: 84,
      historicalTransitBreakdown: expect.objectContaining({
        eligible: true,
        serviceShare: 1,
        score: 84
      }),
      operationalScore: 65
    });
    expect(report.rawEvidence.some((evidence) => "operationalFlowProfile" in evidence.evidenceJson)).toBe(true);
    expect(report.observations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "forensic_operational_boundary_flow",
        scoreImpact: 65
      })
    ]));
  });

  it("adds approval-drain provenance evidence and observation for a route-linked transferFrom root", async () => {
    const transfersByAddress = new Map<string, RawTronscanTrc20Transfer[]>([
      [
        subject,
        [
          transfer({ id: "tx-receiver-subject", from: transit, to: subject, amountRaw: "309000000000", at: "2026-05-20T10:05:00.000Z" })
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
          transfer({ id: "tx-receiver-subject", from: transit, to: subject, amountRaw: "309000000000", at: "2026-05-20T10:05:00.000Z" })
        ]
      ]
    ]);

    const report = await runDeepAddressForensicCheck({
      tronClient: {
        listRelatedTrc20Transfers: async (address) => transfersByAddress.get(address) ?? []
      },
      getLabelsForAddress: async () => [],
      getTransaction: async (txHash) => txHash === "tx-drain" ? { ownerAddress: spender } : {},
      listTrc20ApprovalChanges: async () => [approval()],
      getUsdtRestrictionStatus: async (address) => usdtRestriction(address, address === victim ? "1500000000" : "2200000000")
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      pageLimit: 10,
      maxPagesPerAddress: 1,
      maxExpandedIntermediates: 0,
      metadataFetchLimit: 0,
      contractProfileFetchLimit: 0,
      maxInboundSenders: 1,
      maxApprovalDrainCandidates: 5,
      approvalChangeLookupLimit: 5
    });

    expect(report.approvalDrainProvenanceProfiles[0]).toMatchObject({
      victimAddress: victim,
      spenderAddress: spender,
      firstReceiverAddress: transit,
      subjectAddress: subject,
      hopDepth: 1,
      score: 80,
      approvalTxHash: "tx-approval",
      drainTxHash: "tx-drain",
      pathTxHashes: ["tx-drain", "tx-receiver-subject"],
      subjectTokenState: expect.objectContaining({ balanceRaw: "2200000000", isBlacklisted: false }),
      victimTokenState: expect.objectContaining({ balanceRaw: "1500000000", isBlacklisted: false })
    });
    expect(report.rawEvidence.some((evidence) => "approvalDrainProvenanceProfile" in evidence.evidenceJson)).toBe(true);
    expect(report.observations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "forensic_approval_drain_provenance",
        signalGroup: "approval",
        scoreImpact: 80,
        severity: "high"
      })
    ]));
  });

  it("produces contract-driven receiver and transfer profiles for Verify20 incoming funds", async () => {
    const secondVictim = "TVictim2222222222222222222222222222";
    const wrapperContract = "TWrapper11111111111111111111111111";
    const operator = "TOperator111111111111111111111111111";
    const transfersByAddress = new Map<string, RawTronscanTrc20Transfer[]>([
      [
        subject,
        [
          transfer({
            id: "tx-wrapper-drain",
            from: victim,
            to: subject,
            amountRaw: "2576000000",
            at: "2026-05-20T10:00:00.000Z",
            triggerInfo: { methodName: "Verify20" }
          }),
          transfer({
            id: "tx-wrapper-drain-2",
            from: secondVictim,
            to: subject,
            amountRaw: "1200000000",
            at: "2026-05-20T10:01:00.000Z",
            triggerInfo: { methodName: "Verify20" }
          })
        ]
      ],
      [victim, []],
      [secondVictim, []]
    ]);

    const report = await runDeepAddressForensicCheck({
      tronClient: {
        listRelatedTrc20Transfers: async (address) => transfersByAddress.get(address) ?? []
      },
      getLabelsForAddress: async () => [],
      getTransaction: async (txHash) => ({
        ownerAddress: operator,
        contractData: { contract_address: wrapperContract, function_selector: "Verify20(address,address,uint256)" },
        trigger_info: { methodName: "Verify20" },
        trc20TransferInfo: [{
          from_address: txHash === "tx-wrapper-drain" ? victim : secondVictim,
          to_address: subject,
          quant: txHash === "tx-wrapper-drain" ? "2576000000" : "1200000000",
          contract_address: TRON_USDT_CONTRACT_ADDRESS,
          tokenInfo: { tokenAbbr: "USDT", tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenType: "trc20" }
        }]
      }),
      listTrc20ApprovalChanges: async () => [],
      getUsdtRestrictionStatus: async (address) => usdtRestriction(address)
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      pageLimit: 10,
      maxPagesPerAddress: 1,
      maxExpandedIntermediates: 0,
      metadataFetchLimit: 0,
      contractProfileFetchLimit: 0,
      maxInboundSenders: 2,
      maxApprovalDrainCandidates: 5,
      approvalChangeLookupLimit: 5
    });

    expect(report.contractDrivenReceiverProfile).toMatchObject({
      totalIncomingTxCount: 2,
      contractDrivenIncomingTxCount: 2,
      contractDrivenIncomingAmountRaw: "3776000000",
      uniqueSourceCount: 2,
      dominantMethod: "Verify20"
    });
    expect(report.contractDrivenTransferProfiles).toEqual(expect.arrayContaining([
      expect.objectContaining({
        txHash: "tx-wrapper-drain",
        method: "Verify20",
        callerAddress: operator,
        contractAddress: wrapperContract,
        sourceAddress: victim,
        receiverAddress: subject,
        sourcePostDebitActivity: expect.objectContaining({
          checked: true,
          laterTxCount: 0
        })
      })
    ]));
  });

  it("enriches every Verify20 incoming transfer in a large drainer-like receiver campaign", async () => {
    const wrapperContract = "TWrapperMass111111111111111111111";
    const operator = "TOperatorMass11111111111111111111";
    const victims = Array.from({ length: 24 }, (_, index) => `TVictimMass${String(index).padStart(2, "0")}111111111111111`);
    const transfersByAddress = new Map<string, RawTronscanTrc20Transfer[]>([
      [
        subject,
        victims.map((victimAddress, index) => transfer({
          id: `tx-wrapper-mass-${index}`,
          from: victimAddress,
          to: subject,
          amountRaw: `${(index + 1) * 1_000_000}`,
          at: `2026-05-20T10:${String(index).padStart(2, "0")}:00.000Z`,
          triggerInfo: { methodName: "Verify20" }
        }))
      ],
      ...victims.map((victimAddress): [string, RawTronscanTrc20Transfer[]] => [victimAddress, []])
    ]);
    const getTransactionCalls: string[] = [];

    const report = await runDeepAddressForensicCheck({
      tronClient: {
        listRelatedTrc20Transfers: async (address) => transfersByAddress.get(address) ?? []
      },
      getLabelsForAddress: async () => [],
      getTransaction: async (txHash) => {
        getTransactionCalls.push(txHash);
        const index = Number(txHash.replace("tx-wrapper-mass-", ""));
        return {
          ownerAddress: operator,
          contractData: { contract_address: wrapperContract, function_selector: "Verify20(address,address,uint256)" },
          trigger_info: { methodName: "Verify20" },
          trc20TransferInfo: [{
            from_address: victims[index],
            to_address: subject,
            quant: `${(index + 1) * 1_000_000}`,
            contract_address: TRON_USDT_CONTRACT_ADDRESS,
            tokenInfo: { tokenAbbr: "USDT", tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenType: "trc20" }
          }]
        };
      },
      listTrc20ApprovalChanges: async () => [],
      getUsdtRestrictionStatus: async (address) => usdtRestriction(address)
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      pageLimit: 50,
      maxPagesPerAddress: 1,
      maxExpandedIntermediates: 0,
      metadataFetchLimit: 0,
      contractProfileFetchLimit: 0,
      maxInboundSenders: 30,
      maxApprovalDrainCandidates: 5,
      approvalChangeLookupLimit: 5
    });

    const profiles = report.contractDrivenTransferProfiles ?? [];
    expect(report.contractDrivenReceiverProfile?.contractDrivenIncomingTxCount).toBe(24);
    expect(profiles).toHaveLength(24);
    expect(new Set(getTransactionCalls.filter((txHash) => txHash.startsWith("tx-wrapper-mass-"))).size).toBe(24);
    expect(profiles.every((profile) => profile.contractAddress === wrapperContract)).toBe(true);
  });

  it("keeps Verify20 edge details when duplicate upstream fetch returns the same tx as a plain transfer", async () => {
    const wrapperContract = "TWrapperDuplicate111111111111111111";
    const operator = "TOperatorDuplicate11111111111111111";
    const txHash = "tx-wrapper-duplicate";
    const transfersByAddress = new Map<string, RawTronscanTrc20Transfer[]>([
      [
        subject,
        [
          transfer({
            id: txHash,
            from: victim,
            to: subject,
            amountRaw: "5789000000",
            at: "2026-05-20T10:00:00.000Z",
            triggerInfo: { methodName: "Verify20" }
          })
        ]
      ],
      [
        victim,
        [
          transfer({
            id: txHash,
            from: victim,
            to: subject,
            amountRaw: "5789000000",
            at: "2026-05-20T10:00:00.000Z"
          })
        ]
      ]
    ]);

    const report = await runDeepAddressForensicCheck({
      tronClient: {
        listRelatedTrc20Transfers: async (address) => transfersByAddress.get(address) ?? []
      },
      getLabelsForAddress: async () => [],
      getTransaction: async () => ({
        ownerAddress: operator,
        contractData: { contract_address: wrapperContract, function_selector: "Verify20(address,address,uint256)" },
        trigger_info: { methodName: "Verify20" },
        trc20TransferInfo: [{
          from_address: victim,
          to_address: subject,
          quant: "5789000000",
          contract_address: TRON_USDT_CONTRACT_ADDRESS,
          tokenInfo: { tokenAbbr: "USDT", tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenType: "trc20" }
        }]
      }),
      listTrc20ApprovalChanges: async () => [],
      getUsdtRestrictionStatus: async (address) => usdtRestriction(address)
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      pageLimit: 10,
      maxPagesPerAddress: 1,
      maxExpandedIntermediates: 0,
      metadataFetchLimit: 0,
      contractProfileFetchLimit: 0,
      maxInboundSenders: 1
    });

    expect(report.contractDrivenReceiverProfile?.contractDrivenIncomingTxCount).toBe(1);
    expect(report.contractDrivenTransferProfiles).toEqual([
      expect.objectContaining({
        txHash,
        method: "Verify20",
        contractAddress: wrapperContract,
        sourceAddress: victim,
        receiverAddress: subject
      })
    ]);
  });

  it("finds a two-hop approval-drain root by expanding the top upstream receiver candidate", async () => {
    const calls: string[] = [];
    const transfersByAddress = new Map<string, RawTronscanTrc20Transfer[]>([
      [
        subject,
        [
          transfer({ id: "tx-transit-subject", from: transit, to: subject, amountRaw: "300000000000", at: "2026-05-20T10:05:00.000Z" })
        ]
      ],
      [
        transit,
        [
          transfer({ id: "tx-receiver-transit", from: risky, to: transit, amountRaw: "310000000000", at: "2026-05-20T10:02:00.000Z" }),
          transfer({ id: "tx-transit-subject", from: transit, to: subject, amountRaw: "300000000000", at: "2026-05-20T10:05:00.000Z" })
        ]
      ],
      [
        risky,
        [
          transfer({
            id: "tx-drain",
            from: victim,
            to: risky,
            amountRaw: "311851000000",
            at: "2026-05-20T10:00:00.000Z",
            triggerInfo: { methodName: "transferFrom", methodId: "23b872dd" }
          }),
          transfer({ id: "tx-receiver-transit", from: risky, to: transit, amountRaw: "310000000000", at: "2026-05-20T10:02:00.000Z" })
        ]
      ]
    ]);

    const report = await runDeepAddressForensicCheck({
      tronClient: {
        listRelatedTrc20Transfers: async (address) => {
          calls.push(address);
          return transfersByAddress.get(address) ?? [];
        }
      },
      getLabelsForAddress: async () => [],
      getTransaction: async (txHash) => txHash === "tx-drain" ? { ownerAddress: spender } : {},
      listTrc20ApprovalChanges: async () => [approval()],
      getUsdtRestrictionStatus: async (address) => usdtRestriction(address)
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      pageLimit: 10,
      maxPagesPerAddress: 1,
      maxExpandedIntermediates: 0,
      metadataFetchLimit: 0,
      contractProfileFetchLimit: 0,
      maxInboundSenders: 1,
      maxApprovalDrainCandidates: 5,
      approvalChangeLookupLimit: 5
    });

    expect(calls).toContain(risky);
    expect(report.approvalDrainProvenanceProfiles[0]).toMatchObject({
      firstReceiverAddress: risky,
      hopDepth: 2,
      score: 70,
      pathTxHashes: ["tx-drain", "tx-receiver-transit", "tx-transit-subject"]
    });
  });

  it("adds asset-continuation profiles and observations from all-token subject transfers", async () => {
    const calls: Array<{ address: string; limit?: number; minTimestamp?: number; endTimestamp?: number }> = [];
    const allTokenTransfers = [
      transfer({
        id: "tx-usdt-out",
        from: subject,
        to: protocol,
        amountRaw: "101607508600",
        at: "2026-05-20T10:00:00.000Z"
      }),
      transfer({
        id: "tx-token-in",
        from: protocol,
        to: subject,
        amountRaw: "101607508600",
        at: "2026-05-20T10:00:03.000Z",
        contractAddress: wrappedToken,
        tokenInfo: {
          tokenAbbr: "WRAPPED",
          tokenDecimal: 6,
          tokenId: wrappedToken,
          tokenName: "Wrapped Protocol Token",
          tokenType: "trc20"
        }
      }),
      transfer({
        id: "tx-token-out",
        from: subject,
        to: risky,
        amountRaw: "101607508600",
        at: "2026-05-20T10:00:10.000Z",
        contractAddress: wrappedToken,
        riskTransaction: true,
        tokenInfo: {
          tokenAbbr: "WRAPPED",
          tokenDecimal: 6,
          tokenId: wrappedToken,
          tokenName: "Wrapped Protocol Token",
          tokenType: "trc20"
        }
      })
    ];

    const report = await runDeepAddressForensicCheck({
      tronClient: {
        listRelatedTrc20Transfers: async (address) => address === subject ? [allTokenTransfers[0]] : [],
        listRelatedTrc20TransfersAllTokens: async (address, options) => {
          calls.push({
            address,
            limit: options?.limit,
            minTimestamp: options?.minTimestamp,
            endTimestamp: options?.endTimestamp
          });
          return address === subject ? allTokenTransfers : [];
        }
      },
      getLabelsForAddress: async () => []
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      pageLimit: 10,
      maxPagesPerAddress: 1,
      maxExpandedIntermediates: 0,
      metadataFetchLimit: 0,
      contractProfileFetchLimit: 0,
      maxInboundSenders: 0,
      assetContinuationTransferLimit: 3
    });

    expect(calls).toEqual([
      {
        address: subject,
        limit: 3,
        minTimestamp: Date.parse("2026-05-01T00:00:00.000Z"),
        endTimestamp: Date.parse("2026-05-24T00:00:00.000Z")
      }
    ]);
    expect(report.assetContinuationProfiles?.[0]).toMatchObject({
      evidenceClass: "asset_continuation",
      destinationRisk: "provider_risk",
      tokenQuality: "verified"
    });
    expect(report.rawEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: "tronscan_all_token_transfer_history",
        sourceType: "detector_output",
        txHash: "tx-token-in",
        observedTransactionHash: "tx-token-out"
      })
    ]));
    expect(report.observations.map((item) => item.code)).toContain("forensic_asset_continuation");
  });

  it("adds coverage debug rows and sparse historical fallback counts", async () => {
    const latestOnly = "TLatestOnly111111111111111111111111111";
    const calls: Array<{ address: string; hasWindow: boolean; limit?: number }> = [];
    const windowTransfers = [
      transfer({ id: "tx-window-1", from: transit, to: subject, amountRaw: "100000000000", at: "2026-05-20T10:00:00.000Z" }),
      transfer({ id: "tx-window-2", from: subject, to: risky, amountRaw: "90000000000", at: "2026-05-20T11:00:00.000Z" })
    ];
    const latestTransfers = [
      ...windowTransfers,
      transfer({ id: "tx-latest-outside-window", from: latestOnly, to: subject, amountRaw: "50000000000", at: "2026-04-01T10:00:00.000Z" })
    ];

    const report = await runDeepAddressForensicCheck({
      tronClient: {
        listRelatedTrc20Transfers: async (address, options) => {
          calls.push({ address, hasWindow: Boolean(options?.minTimestamp), limit: options?.limit });
          if (address !== subject) return [];
          return options?.minTimestamp ? windowTransfers : latestTransfers;
        }
      },
      getLabelsForAddress: async () => []
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      pageLimit: 10,
      maxPagesPerAddress: 1,
      maxExpandedIntermediates: 0,
      metadataFetchLimit: 0,
      contractProfileFetchLimit: 0,
      maxInboundSenders: 0,
      recentFallbackMinTransferCount: 60,
      recentFallbackTransferLimit: 60
    });

    expect(calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ address: subject, hasWindow: false, limit: 60 })
    ]));
    expect(report.coverageDebug.summary).toMatchObject({
      thirtyDayTransferCount: 2,
      historicalFallbackTransferCount: 3,
      historicalFallbackRequestedLimit: 60,
      directCounterpartyCount: 3
    });
    expect(report.coverageDebug.rows.map((row) => row.counterparty)).toEqual(expect.arrayContaining([
      transit,
      risky,
      latestOnly
    ]));
    expect(report.coverageDebug.missingChecks).toEqual(expect.arrayContaining([
      expect.stringContaining("30d window had 2 USDT transfers")
    ]));
  });
});
