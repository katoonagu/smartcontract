import { describe, expect, it } from "vitest";
import { TronWeb } from "tronweb";
import {
  normalizePersistedDeepFirstHopEvidence,
  runDeepAddressForensicCheck
} from "../../src/check/deepForensicCheck";
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
const gasFreeController = "TFFAMQLZybALaLb4uxHA9RBE7pxhUAjF3U";
const gasFreeAccount = "TRivmRsLwVRZETXqPdv98raFPHMkwuMnxP";
const gasFreeUser = "TW2Py9fWGc1HVXhejufX1stuwQ9N42Y8RE";
const gasFreeReceiver = "TMwjbNHpsVSjn93vtWtLnThHwhAJAnrWNq";
const gasFreeTlnt = "TLntW9Z59LYY5KEi9cmwk3PKjQga828ird";

const gasFreeUintWord = (value: bigint): string => value.toString(16).padStart(64, "0");
const gasFreeAddressWord = (address: string): string => TronWeb.address.toHex(address).slice(2).padStart(64, "0");

function gasFreeTransaction(input: {
  accountAddress: string;
  receiverAddress: string;
  principalAmountRaw?: string;
  feeAmountRaw?: string;
}) {
  const principalAmountRaw = input.principalAmountRaw ?? "97000000";
  const feeAmountRaw = input.feeAmountRaw ?? "3000000";
  const signature = "11".repeat(65);
  const data = [
    "6f21b898",
    gasFreeAddressWord(TRON_USDT_CONTRACT_ADDRESS),
    gasFreeAddressWord(gasFreeUser),
    gasFreeAddressWord(input.receiverAddress),
    gasFreeUintWord(BigInt(principalAmountRaw)),
    gasFreeUintWord(BigInt(feeAmountRaw)),
    gasFreeUintWord(1_800_000_000n),
    gasFreeUintWord(1n),
    gasFreeUintWord(9n),
    gasFreeUintWord(0x120n),
    gasFreeUintWord(65n),
    signature.padEnd(192, "0")
  ].join("");
  const row = (toAddress: string, amountRaw: string) => ({
    from_address: input.accountAddress,
    to_address: toAddress,
    amount_str: amountRaw,
    contract_address: TRON_USDT_CONTRACT_ADDRESS,
    tokenInfo: { tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenAbbr: "USDT", tokenType: "trc20" }
  });
  return {
    confirmed: true,
    contractRet: "SUCCESS",
    revert: false,
    contractData: { contract_address: gasFreeController, data },
    trigger_info: { methodName: "permitTransfer" },
    trc20TransferInfo: [
      row(input.receiverAddress, principalAmountRaw),
      row(gasFreeTlnt, feeAmountRaw)
    ]
  };
}

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
        amountRaw: "1000000000",
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

  it("reports indexed second-layer relationships from all-time direct wallets", async () => {
    const sourceAddress = "TSubjectSecondLayer111111111111111";
    const walletA = "TSecondLayerWalletA11111111111111";
    const walletB = "TSecondLayerWalletB11111111111111";
    const subjectTransfers = [indexed({
      id: "tx-subject-a",
      from: sourceAddress,
      to: walletA,
      amountRaw: "100000000",
      at: "2026-06-01T00:00:00.000Z"
    })];
    const walletTransfers = [indexed({
      id: "tx-a-b",
      from: walletA,
      to: walletB,
      amountRaw: "50000000",
      at: "2026-06-02T00:00:00.000Z"
    })];

    const report = await runDeepAddressForensicCheck({
      tronClient: { listRelatedTrc20Transfers: async () => [] },
      listIndexedUsdtTransfersForAddress: async (address, options) => {
        const transfers = address === sourceAddress ? subjectTransfers : address === walletA ? walletTransfers : [];
        const windowed = transfers.filter((item) =>
          item.blockTimestamp >= options.minTimestamp && item.blockTimestamp <= options.maxTimestamp
        );
        return windowed.slice(options.offset ?? 0, (options.offset ?? 0) + options.limit);
      },
      getAddressUsdtIndexState: async (address) => address === walletA ? completeIndexState(walletA, 1, 2) : null,
      getLabelsForAddress: async () => [],
      getAddressMetadata: async () => null,
      getContractIntelligenceProfile: async () => null,
      getUsdtRestrictionStatus: async (address) => usdtRestriction(address)
    }, {
      sourceAddress,
      windowStart: new Date("2026-06-15T00:00:00.000Z"),
      windowEnd: new Date("2026-07-02T00:00:00.000Z"),
      pageLimit: 50,
      maxPagesPerAddress: 3,
      maxInboundSenders: 1,
      extendedSearchMode: "disabled",
      allTimeSubjectIndexState: completeIndexState(sourceAddress, 1, 1),
      allTimeMode: "strict",
      secondLayerMaxActiveWalletsPerJob: 25
    });

    expect(report.secondLayerRelationshipProfiles).toMatchObject({
      subjectAddress: sourceAddress,
      directWalletStatuses: [
        expect.objectContaining({
          address: walletA,
          status: "expanded",
          savedPathCount: 1
        })
      ],
      paths: [
        expect.objectContaining({
          source: "deepcheck_relationship_second_hop",
          subjectAddress: sourceAddress,
          directWalletAddress: walletA,
          secondHopAddress: walletB,
          pathAddresses: [sourceAddress, walletA, walletB],
          txHashes: ["tx-a-b"]
        })
      ],
      counters: expect.objectContaining({
        expanded: 1,
        complete: 1,
        maxSavedDepth: 2
      })
    });
    expect(report.coverage.allTime).toMatchObject({
      secondLayerActiveBudget: 25,
      secondLayerComplete: 1
    });
    expect(report.coverage.secondLayerRelationshipPaths).toBe(1);
    expect(report.coverage.secondLayerRelationshipGroups).toBe(0);
  });

  it("does not count second-layer queue requests as queued indexing side effects", async () => {
    const sourceAddress = "TSubjectSecondLayerQueue111111111";
    const walletA = "TSecondLayerQueueWalletA1111111111";
    const subjectTransfers = [indexed({
      id: "tx-subject-queue-a",
      from: sourceAddress,
      to: walletA,
      amountRaw: "100000000",
      at: "2026-06-01T00:00:00.000Z"
    })];

    const report = await runDeepAddressForensicCheck({
      tronClient: { listRelatedTrc20Transfers: async () => [] },
      listIndexedUsdtTransfersForAddress: async (address, options) => {
        if (address !== sourceAddress) return [];
        return subjectTransfers.slice(options.offset ?? 0, (options.offset ?? 0) + options.limit);
      },
      getAddressUsdtIndexState: async () => null,
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
      allTimeSubjectIndexState: completeIndexState(sourceAddress, 1, 1),
      allTimeMode: "strict",
      secondLayerMaxActiveWalletsPerJob: 25
    });

    expect(report.secondLayerRelationshipProfiles?.queueRequests).toEqual([
      { address: walletA, coverageMode: "all_time", queuedReason: "deep_second_layer" }
    ]);
    expect(report.coverage.allTime).toMatchObject({
      directWalletsQueuedForIndexing: 0,
      secondLayerQueued: 0
    });
  });

  it("does not truncate all-time direct boundary by stale fetched transfer count", async () => {
    const sourceAddress = "TSubjectAllTimeStaleCount111111111";
    const transfers = Array.from({ length: 5 }, (_, index) =>
      indexed({
        id: `tx-stale-count-${index}`,
        from: `TStaleSender${String(index).padStart(2, "0")}1111111111111111`,
        to: sourceAddress,
        amountRaw: String((index + 1) * 1_000_000),
        at: `2026-06-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
        eventIndex: index
      })
    );
    const reads: Array<{ offset?: number; limit: number }> = [];

    const report = await runDeepAddressForensicCheck({
      tronClient: { listRelatedTrc20Transfers: async () => [] },
      listIndexedUsdtTransfersForAddress: async (address, options) => {
        if (address !== sourceAddress) return [];
        reads.push({ offset: options.offset, limit: options.limit });
        const offset = options.offset ?? 0;
        return transfers.slice(offset, offset + options.limit);
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
      allTimeSubjectIndexState: completeIndexState(sourceAddress, 2, 5),
      allTimeMode: "strict"
    });

    expect(report.coverage.allTime?.subjectUniqueDirectWallets).toBe(5);
    expect(report.directCounterpartyInteractionProfiles ?? []).toHaveLength(5);
    expect(reads[0]).toEqual({ offset: 0, limit: 1000 });
  });

  it("does not truncate full all-time direct boundary by stale indexed transfer count", async () => {
    const sourceAddress = "TSubjectAllTimeBounded111111111111";
    const transfers = Array.from({ length: 4 }, (_, index) =>
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

    expect(reads.filter((read) => read.offset !== undefined)).toEqual([{ offset: 0, limit: 1000 }]);
    expect(report.coverage.allTime?.subjectUniqueDirectWallets).toBe(4);
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

  it("carries exact all-time first-hop facts with timeline chronology into the fresh report", async () => {
    const sourceAddress = "TSubjectFirstHopAllTime111111111111";
    const counterparty = "TFirstHopAllTimeBlacklisted111111111";
    const blacklistEventTxHash = "b".repeat(64);
    const transfers = [
      indexed({
        id: "tx-before-blacklist",
        from: counterparty,
        to: sourceAddress,
        amountRaw: "6000000000",
        at: "2026-05-01T00:00:00.000Z"
      }),
      indexed({
        id: "tx-active-blacklist",
        from: counterparty,
        to: sourceAddress,
        amountRaw: "6000000000",
        at: "2026-06-15T00:00:00.000Z",
        eventIndex: 1
      })
    ];
    const restrictionCalls: Array<{ address: string; includeEventTimeline: boolean | undefined }> = [];

    const report = await runDeepAddressForensicCheck({
      tronClient: { listRelatedTrc20Transfers: async () => [] },
      listIndexedUsdtTransfersForAddress: async (address, options) => {
        if (address !== sourceAddress) return [];
        return transfers.slice(options.offset ?? 0, (options.offset ?? 0) + options.limit);
      },
      getLabelsForAddress: async (address) => address === counterparty ? [label(address)] : [],
      getAddressMetadata: async () => null,
      getContractIntelligenceProfile: async () => null,
      getUsdtRestrictionStatus: async (address, options) => {
        restrictionCalls.push({ address, includeEventTimeline: options?.includeEventTimeline });
        return {
          ...usdtRestriction(address),
          isBlacklisted: address === counterparty,
          blacklistEventTxHash: address === counterparty ? blacklistEventTxHash : null,
          blacklistEventTimestamp: address === counterparty ? "2026-06-01T00:00:00.000Z" : null,
          blacklistEventBlock: address === counterparty ? 200 : null,
          blacklistTimeline: address === counterparty ? {
            address,
            events: [{
              eventKind: "added" as const,
              address,
              tokenContract: TRON_USDT_CONTRACT_ADDRESS,
              occurredAt: "2026-06-01T00:00:00.000Z",
              txHash: blacklistEventTxHash,
              blockNumber: 200,
              logIndex: 3,
              verification: "verified_contract_log" as const
            }],
            pagination: "complete" as const,
            failureReason: null,
            checkedAt: "2026-07-02T00:00:00.000Z"
          } : null
        };
      }
    }, {
      sourceAddress,
      windowStart: new Date("2026-05-15T00:00:00.000Z"),
      windowEnd: new Date("2026-07-02T00:00:00.000Z"),
      pageLimit: 50,
      maxPagesPerAddress: 1,
      maxInboundSenders: 0,
      extendedSearchMode: "disabled",
      allTimeSubjectIndexState: completeIndexState(sourceAddress, 2, 1),
      allTimeMode: "strict"
    });

    expect(restrictionCalls).toContainEqual({ address: counterparty, includeEventTimeline: true });
    expect(report.firstHopBlacklistFacts).toEqual([expect.objectContaining({
      counterpartyAddress: counterparty,
      direction: "inbound",
      principalAmountRaw: "12000000000",
      directionalPrincipalShare: 1,
      shareSemantics: "exact",
      transferTxHashes: ["tx-active-blacklist", "tx-before-blacklist"],
      temporalRelation: "mixed",
      beforeEffectiveAmountRaw: "6000000000",
      activeAmountRaw: "6000000000",
      unknownTimingAmountRaw: "0",
      timelineCoverage: "complete",
      timelineEvents: [expect.objectContaining({ txHash: blacklistEventTxHash, logIndex: 3 })]
    })]);
    expect(report.firstHopLabelFacts).toEqual([expect.objectContaining({
      counterpartyAddress: counterparty,
      direction: "inbound",
      principalAmountRaw: "12000000000",
      directionalPrincipalShare: 1,
      transferTxHashes: ["tx-active-blacklist", "tx-before-blacklist"],
      // Deep has no typed selected Where/Incoming identity yet; the later caller join owns this link.
      linkedToSelectedProvenance: false
    })]);
    expect(report.firstHopBlacklistCoverage).toMatchObject({
      requiredForDecision: true,
      scope: "all_time",
      windowStart: null,
      windowEnd: null,
      directPrincipalTransferCoverage: "complete",
      blacklistCheckCoverage: "complete",
      completeTimelineFactCount: 1,
      partialTimelineFactCount: 0
    });
    expect(report.directHardEvidenceSnapshots?.[0]?.usdtRestriction?.blacklistTimeline).toMatchObject({
      pagination: "complete",
      events: [expect.objectContaining({ txHash: blacklistEventTxHash })]
    });
    expect(JSON.parse(JSON.stringify(report.firstHopBlacklistFacts))).toEqual(report.firstHopBlacklistFacts);
  });

  it("builds partial first-hop facts only from the bounded checked window", async () => {
    const sourceAddress = "TSubjectFirstHopBounded111111111111";
    const inWindowCounterparty = "TFirstHopBoundedInside111111111111";
    const outsideCounterparty = "TFirstHopBoundedOutside11111111111";
    const windowTransfers = [transfer({
      id: "tx-inside-window",
      from: sourceAddress,
      to: inWindowCounterparty,
      amountRaw: "10000000000",
      at: "2026-05-20T00:00:00.000Z"
    })];
    const sparseFallbackTransfers = [
      ...windowTransfers,
      transfer({
        id: "tx-outside-window",
        from: outsideCounterparty,
        to: sourceAddress,
        amountRaw: "90000000000",
        at: "2026-04-01T00:00:00.000Z"
      })
    ];

    const report = await runDeepAddressForensicCheck({
      tronClient: {
        listRelatedTrc20Transfers: async (address, options) => {
          if (address !== sourceAddress) return [];
          return options?.minTimestamp === undefined ? sparseFallbackTransfers : windowTransfers;
        }
      },
      getLabelsForAddress: async (address) => address === inWindowCounterparty ? [label(address)] : [],
      getAddressMetadata: async () => null,
      getContractIntelligenceProfile: async () => null,
      getUsdtRestrictionStatus: async (address) => ({
        ...usdtRestriction(address),
        isBlacklisted: address === inWindowCounterparty || address === outsideCounterparty,
        blacklistTimeline: null
      })
    }, {
      sourceAddress,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      pageLimit: 10,
      maxPagesPerAddress: 1,
      maxInboundSenders: 0,
      extendedSearchMode: "disabled",
      recentFallbackMinTransferCount: 60,
      recentFallbackTransferLimit: 60
    });

    expect(report.firstHopBlacklistFacts).toEqual([expect.objectContaining({
      counterpartyAddress: inWindowCounterparty,
      direction: "outbound",
      principalAmountRaw: "10000000000",
      directionalPrincipalShare: null,
      shareSemantics: "unavailable",
      transferTxHashes: ["tx-inside-window"],
      directTransferCoverage: "partial",
      timelineCoverage: "partial"
    })]);
    expect(report.firstHopBlacklistFacts?.some((fact) =>
      fact.counterpartyAddress === outsideCounterparty || fact.transferTxHashes.includes("tx-outside-window")
    )).toBe(false);
    expect(report.firstHopLabelFacts).toEqual([expect.objectContaining({
      counterpartyAddress: inWindowCounterparty,
      direction: "outbound",
      directionalPrincipalShare: null,
      shareSemantics: "unavailable",
      linkedToSelectedProvenance: false
    })]);
    expect(report.firstHopBlacklistCoverage).toMatchObject({
      requiredForDecision: true,
      scope: "checked_window",
      windowStart: "2026-05-01T00:00:00.000Z",
      windowEnd: "2026-05-24T00:00:00.000Z",
      directPrincipalTransferCoverage: "partial",
      blacklistCheckCoverage: "history_partial",
      incompleteReason: expect.stringContaining("partial")
    });
  });

  it("reports provider_failed first-hop coverage when a fresh final Deep run has no restriction provider", async () => {
    const sourceAddress = "TSubjectNoRestrictionProvider111111111";
    const counterparty = "TNoRestrictionProviderCounterparty11111";
    const report = await runDeepAddressForensicCheck({
      tronClient: {
        listRelatedTrc20Transfers: async (address) => address === sourceAddress ? [transfer({
          id: "tx-no-restriction-provider",
          from: counterparty,
          to: sourceAddress,
          amountRaw: "10000000000",
          at: "2026-05-20T00:00:00.000Z"
        })] : []
      },
      getLabelsForAddress: async () => []
    }, {
      sourceAddress,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      maxPagesPerAddress: 1,
      pageLimit: 10,
      maxInboundSenders: 0,
      extendedSearchMode: "disabled"
    });

    expect(report.firstHopBlacklistCoverage).toMatchObject({
      requiredForDecision: true,
      blacklistCheckCoverage: "provider_failed",
      incompleteReason: expect.stringMatching(/provider.*not available/i)
    });
  });

  it("fails closed when an indexed direct principal row is invalid", async () => {
    const sourceAddress = "TSubjectInvalidFirstHop1111111111111";
    const counterparty = "TInvalidFirstHopCounterparty111111111";
    const invalid = indexed({
      id: "tx-invalid-first-hop",
      from: counterparty,
      to: sourceAddress,
      amountRaw: "10000000000",
      at: "2026-05-20T00:00:00.000Z"
    });
    invalid.amountRaw = "not-a-number";

    const report = await runDeepAddressForensicCheck({
      tronClient: { listRelatedTrc20Transfers: async () => [] },
      listIndexedUsdtTransfersForAddress: async (address, options) => address === sourceAddress
        ? [invalid].slice(options.offset ?? 0, (options.offset ?? 0) + options.limit)
        : [],
      getLabelsForAddress: async () => [],
      getUsdtRestrictionStatus: async (address) => usdtRestriction(address)
    }, {
      sourceAddress,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      pageLimit: 10,
      maxPagesPerAddress: 1,
      maxInboundSenders: 0,
      extendedSearchMode: "disabled",
      allTimeSubjectIndexState: completeIndexState(sourceAddress, 1, 1),
      allTimeMode: "strict"
    });

    expect(report.firstHopBlacklistFacts).toEqual([]);
    expect(report.firstHopLabelFacts).toEqual([]);
    expect(report.firstHopBlacklistCoverage).toMatchObject({
      requiredForDecision: true,
      scope: "checked_window",
      directPrincipalTransferCoverage: "partial",
      blacklistCheckCoverage: "history_partial",
      incompleteReason: expect.stringMatching(/invalid.*clean/i)
    });
    expect(report.missingChecks).toEqual(expect.arrayContaining([
      expect.stringMatching(/invalid.*clean/i)
    ]));
  });

  it("downgrades conflicting all-time transaction chronology instead of reporting clean complete coverage", async () => {
    const sourceAddress = "TSubjectConflictFirstHop111111111111";
    const first = "TConflictFirstHopA111111111111111111";
    const second = "TConflictFirstHopB11111111111111111";
    const transfers = [
      indexed({
        id: "tx-conflicting-first-hop",
        from: first,
        to: sourceAddress,
        amountRaw: "10000000000",
        at: "2026-05-20T00:00:00.000Z"
      }),
      indexed({
        id: "tx-conflicting-first-hop",
        from: second,
        to: sourceAddress,
        amountRaw: "10000000000",
        at: "2026-05-21T00:00:00.000Z",
        eventIndex: 1
      })
    ];

    const report = await runDeepAddressForensicCheck({
      tronClient: { listRelatedTrc20Transfers: async () => [] },
      listIndexedUsdtTransfersForAddress: async (address, options) => address === sourceAddress
        ? transfers.slice(options.offset ?? 0, (options.offset ?? 0) + options.limit)
        : [],
      getLabelsForAddress: async () => [],
      getUsdtRestrictionStatus: async (address) => ({
        ...usdtRestriction(address),
        isBlacklisted: true,
        blacklistTimeline: {
          address,
          events: [{
            eventKind: "added" as const,
            address,
            tokenContract: TRON_USDT_CONTRACT_ADDRESS,
            occurredAt: "2026-05-10T00:00:00.000Z",
            txHash: `tx-added-${address}`,
            blockNumber: 10,
            logIndex: 0,
            verification: "verified_contract_log" as const
          }],
          pagination: "complete" as const,
          failureReason: null,
          checkedAt: "2026-05-24T00:00:00.000Z"
        }
      })
    }, {
      sourceAddress,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      pageLimit: 10,
      maxPagesPerAddress: 1,
      maxInboundSenders: 0,
      extendedSearchMode: "disabled",
      allTimeSubjectIndexState: completeIndexState(sourceAddress, 2, 2),
      allTimeMode: "strict"
    });

    expect(report.firstHopBlacklistFacts).toHaveLength(2);
    expect(report.firstHopBlacklistFacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        directTransferCoverage: "partial",
        directionalPrincipalShare: null,
        shareSemantics: "unavailable",
        temporalRelation: "unknown",
        unknownTimingAmountRaw: "10000000000"
      })
    ]));
    expect(report.firstHopBlacklistCoverage).toMatchObject({
      requiredForDecision: true,
      scope: "checked_window",
      directPrincipalTransferCoverage: "partial",
      blacklistCheckCoverage: "history_partial",
      incompleteReason: expect.stringMatching(/conflicting timestamps/i)
    });
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
    // Fast-snapshot enrichment still prioritizes the hint, while the independent
    // first-hop evidence pass checks the absolute-material top counterparty.
    expect(restrictionCalls).toContain(top);
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

  it.each([
    ["with one ordinary slot", 3, 2, 1, true],
    ["when the configured reserve exceeds the total", 1, 5, 0, false]
  ] as const)("reserves the shared transaction budget for exact approval-drain evidence %s", async (
    _label,
    totalLimit,
    maxApprovalDrainCandidates,
    ordinaryAllowance,
    expectsReceiverLookup
  ) => {
    const noiseEdges = Array.from({ length: 4 }, (_, index) => transfer({
      id: `tx-hard-reserve-noise-${index}`,
      from: transit,
      to: `THardReserveNoise${index}11111111111111111111`,
      amountRaw: `${1_000_000 + index}`,
      at: `2026-05-20T09:0${index}:00.000Z`
    }));
    const receiverEdge = transfer({
      id: "tx-hard-reserve-receiver-subject",
      from: transit,
      to: subject,
      amountRaw: "309000000000",
      at: "2026-05-20T10:05:00.000Z"
    });
    const drainEdge = transfer({
      id: "tx-hard-reserve-drain",
      from: victim,
      to: transit,
      amountRaw: "311851000000",
      at: "2026-05-20T10:00:00.000Z",
      triggerInfo: { methodName: "transferFrom", methodId: "23b872dd" }
    });
    const transfersByAddress = new Map<string, RawTronscanTrc20Transfer[]>([
      [transit, [...noiseEdges, drainEdge, receiverEdge]]
    ]);
    const getTransactionCalls: string[] = [];
    const stablecoinCalls: string[] = [];

    const report = await runDeepAddressForensicCheck({
      tronClient: {
        listRelatedTrc20Transfers: async (address) => transfersByAddress.get(address) ?? []
      },
      getLabelsForAddress: async () => [],
      getTransaction: async (txHash) => {
        getTransactionCalls.push(txHash);
        return txHash === "tx-hard-reserve-drain" ? { ownerAddress: spender } : {};
      },
      listTrc20ApprovalChanges: async () => [approval({
        txHash: "tx-hard-reserve-approval",
        ownerAddress: victim,
        spenderAddress: spender
      })],
      getUsdtRestrictionStatus: async (address) => {
        stablecoinCalls.push(address);
        return usdtRestriction(address, address === victim ? "1500000000" : "2200000000");
      }
    }, {
      sourceAddress: transit,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      pageLimit: 20,
      maxPagesPerAddress: 1,
      maxDepth: 1,
      maxExpandedIntermediates: 0,
      metadataFetchLimit: 0,
      contractProfileFetchLimit: 0,
      maxInboundSenders: 1,
      maxApprovalDrainCandidates,
      approvalChangeLookupLimit: 5,
      economicEdgeTransactionInfoFetchLimit: totalLimit,
      extendedSearchMode: "disabled"
    });

    expect(new Set(getTransactionCalls).size).toBeLessThanOrEqual(totalLimit);
    expect(getTransactionCalls).toEqual(expect.arrayContaining(["tx-hard-reserve-drain"]));
    expect(getTransactionCalls.filter((txHash) => txHash === "tx-hard-reserve-drain")).toHaveLength(1);
    expect(getTransactionCalls.filter((txHash) => txHash === "tx-hard-reserve-receiver-subject"))
      .toHaveLength(expectsReceiverLookup ? 1 : 0);
    expect(report.approvalDrainProvenanceProfiles[0]).toMatchObject({
      victimAddress: victim,
      spenderAddress: spender,
      firstReceiverAddress: transit,
      subjectAddress: transit,
      hopDepth: 0,
      score: 90,
      approvalTxHash: "tx-hard-reserve-approval",
      drainTxHash: "tx-hard-reserve-drain",
      evidenceStrength: "exact_approval_and_transfer_from"
    });
    expect(report.rawEvidence.some((evidence) => "approvalDrainProvenanceProfile" in evidence.evidenceJson)).toBe(true);
    expect(report.observations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "forensic_approval_drain_provenance",
        signalGroup: "approval",
        scoreImpact: 90
      })
    ]));
    expect(report.missingChecks).toEqual(expect.arrayContaining([
      expect.stringContaining(`limited to ${ordinaryAllowance} ordinary transaction-detail calls within the ${totalLimit} run-wide limit`)
    ]));
    expect(stablecoinCalls).toEqual(expect.arrayContaining([transit, victim]));
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

  it("keeps exact GasFree roles visible without propagating service-fee risk", async () => {
    const principalTxHash = "tx-deep-gasfree-principal";
    const feeTxHash = "tx-deep-gasfree-outgoing";
    const transfersByAddress = new Map<string, RawTronscanTrc20Transfer[]>([
      [
        gasFreeReceiver,
        [
          transfer({
            id: principalTxHash,
            from: gasFreeAccount,
            to: gasFreeReceiver,
            amountRaw: "97000000",
            at: "2026-07-10T00:00:00.000Z",
            triggerInfo: { methodName: "permitTransfer" }
          }),
          transfer({
            id: feeTxHash,
            from: gasFreeReceiver,
            to: gasFreeAccount,
            amountRaw: "97000000",
            at: "2026-07-10T00:05:00.000Z",
            triggerInfo: { methodName: "permitTransfer" }
          }),
          transfer({
            id: feeTxHash,
            from: gasFreeReceiver,
            to: gasFreeTlnt,
            amountRaw: "3000000",
            at: "2026-07-10T00:05:00.000Z",
            triggerInfo: { methodName: "permitTransfer" }
          })
        ]
      ]
    ]);
    const transactions = new Map<string, unknown>([
      [principalTxHash, gasFreeTransaction({ accountAddress: gasFreeAccount, receiverAddress: gasFreeReceiver })],
      [feeTxHash, gasFreeTransaction({ accountAddress: gasFreeReceiver, receiverAddress: gasFreeAccount })]
    ]);

    const report = await runDeepAddressForensicCheck({
      tronClient: {
        listRelatedTrc20Transfers: async (address) => transfersByAddress.get(address) ?? []
      },
      getLabelsForAddress: async (address) =>
        address === gasFreeAccount || address === gasFreeTlnt ? [label(address)] : [],
      getAddressMetadata: async () => null,
      getTransaction: async (txHash) => transactions.get(txHash) ?? null
    }, {
      sourceAddress: gasFreeReceiver,
      windowStart: new Date("2026-07-01T00:00:00.000Z"),
      windowEnd: new Date("2026-07-11T00:00:00.000Z"),
      maxDepth: 1,
      pageLimit: 10,
      maxPagesPerAddress: 1,
      maxExpandedIntermediates: 0,
      metadataFetchLimit: 10,
      contractProfileFetchLimit: 0,
      maxInboundSenders: 0,
      extendedSearchMode: "disabled"
    });

    expect(report.contractDrivenTransferProfiles).toEqual(expect.arrayContaining([
      expect.objectContaining({
        txHash: principalTxHash,
        classification: "gasfree_principal",
        economicRole: "principal",
        economicProtocol: "tron_gasfree",
        countsAsDrainerContext: false
      })
    ]));
    expect(report.contractDrivenCampaignSummary?.campaignClusters).toHaveLength(0);
    expect(report.counterpartyRiskProfiles.some((profile) => profile.counterpartyAddress === gasFreeTlnt)).toBe(false);
    const feeInteraction = report.directCounterpartyInteractionProfiles?.find(
      (profile) => profile.counterpartyAddress === gasFreeTlnt
    );
    expect(feeInteraction).toMatchObject({ scoreContribution: 0 });
    expect(feeInteraction?.transfers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        txHash: feeTxHash,
        economicRole: "service_fee",
        economicProtocol: "tron_gasfree"
      })
    ]));
    expect(report.serviceExposureProfiles[0]?.exposureScore ?? 0).toBe(0);
    const inboundPaths = report.inboundProvenanceProfiles.flatMap((profile) => profile.paths);
    expect(inboundPaths.every((path) => !path.txHashes.includes(feeTxHash))).toBe(true);
    expect(inboundPaths.some((path) => path.txHashes.includes(principalTxHash))).toBe(true);
    expect(report.operationalFlowProfiles?.[0]?.outgoingVolumeRaw).toBe("100000000");
    expect(report.directCounterpartyInteractionProfiles?.some(
      (profile) => profile.counterpartyAddress === gasFreeUser
    )).toBe(false);
    expect(report.contractDrivenTransferProfiles?.flatMap(
      (profile) => [profile.sourceAddress, profile.receiverAddress]
    )).not.toContain(gasFreeUser);
  });

  it("filters an above-threshold exact GasFree fee before route-level risk profiles", async () => {
    const fundingTxHash = "tx-deep-gasfree-high-fee-funding";
    const settlementTxHash = "tx-deep-gasfree-high-fee-settlement";
    const getTransactionCalls: string[] = [];
    const transfersByAddress = new Map<string, RawTronscanTrc20Transfer[]>([
      [
        gasFreeReceiver,
        [
          transfer({
            id: fundingTxHash,
            from: gasFreeAccount,
            to: gasFreeReceiver,
            amountRaw: "1000000000",
            at: "2026-07-10T00:00:00.000Z"
          }),
          transfer({
            id: settlementTxHash,
            from: gasFreeReceiver,
            to: gasFreeAccount,
            amountRaw: "700000000",
            at: "2026-07-10T00:05:00.000Z",
            triggerInfo: { methodName: "permitTransfer" }
          }),
          transfer({
            id: settlementTxHash,
            from: gasFreeReceiver,
            to: gasFreeTlnt,
            amountRaw: "300000000",
            at: "2026-07-10T00:05:00.000Z",
            triggerInfo: { methodName: "permitTransfer" }
          })
        ]
      ]
    ]);

    const report = await runDeepAddressForensicCheck({
      tronClient: {
        listRelatedTrc20Transfers: async (address) => transfersByAddress.get(address) ?? []
      },
      getLabelsForAddress: async () => [],
      getAddressMetadata: async () => null,
      getTransaction: async (txHash) => {
        getTransactionCalls.push(txHash);
        return txHash === settlementTxHash
          ? gasFreeTransaction({
              accountAddress: gasFreeReceiver,
              receiverAddress: gasFreeAccount,
              principalAmountRaw: "700000000",
              feeAmountRaw: "300000000"
            })
          : null;
      }
    }, {
      sourceAddress: gasFreeReceiver,
      windowStart: new Date("2026-07-01T00:00:00.000Z"),
      windowEnd: new Date("2026-07-11T00:00:00.000Z"),
      maxDepth: 1,
      pageLimit: 10,
      maxPagesPerAddress: 1,
      maxExpandedIntermediates: 0,
      metadataFetchLimit: 10,
      contractProfileFetchLimit: 0,
      maxInboundSenders: 0,
      extendedSearchMode: "disabled"
    });

    const serviceExposure = report.serviceExposureProfiles[0];
    expect(serviceExposure).toMatchObject({
      totalOutgoingRaw: "1000000000",
      totalOutgoingCount: 2,
      combinedServiceVolumeRatio: 0,
      exposureScore: 0,
      topServiceCounterparties: [],
      categoryBreakdown: []
    });
    expect(report.fastCounterpartyTopsProfile).toMatchObject({
      outgoingVolumeRaw: "1000000000",
      outgoingTxCount: 2,
      topOutgoingCounterparties: [expect.objectContaining({ address: gasFreeAccount, volumeRaw: "700000000" })],
      topServiceCounterparties: [],
      categoryBreakdown: []
    });
    expect(report.addressBehaviorProfiles[0]).toMatchObject({
      outgoingVolumeRaw: "1000000000",
      outgoingTxCount: 2,
      uniqueOutgoingCounterparties: 1,
      topOutgoingCounterpartyAddress: gasFreeAccount,
      inflowToOutflowRatio: 0.7,
      depositThenDrainScore: 30
    });
    expect(report.boundaryExposureProfiles.flatMap((profile) => profile.flows)).toEqual([]);
    expect(report.boundaryExposureProfiles.every((profile) => profile.contextScore === 0)).toBe(true);
    expect(report.rawEvidence.some((evidence) => "boundaryExposureProfile" in evidence.evidenceJson)).toBe(false);
    expect(report.observations.some((observation) =>
      observation.code === "forensic_service_exposure" ||
      observation.code === "forensic_boundary_exposure_context"
    )).toBe(false);
    expect(JSON.stringify(report.rawEvidence)).not.toContain(settlementTxHash);
    expect(report.operationalFlowProfiles?.[0]).toMatchObject({
      outgoingVolumeRaw: "1000000000",
      topOutgoingCounterparties: [expect.objectContaining({ address: gasFreeAccount, volumeRaw: "700000000" })]
    });

    const feeInteraction = report.directCounterpartyInteractionProfiles?.find(
      (profile) => profile.counterpartyAddress === gasFreeTlnt
    );
    expect(feeInteraction).toMatchObject({ volumeRaw: "300000000", scoreContribution: 0 });
    expect(feeInteraction?.transfers).toEqual([
      expect.objectContaining({
        txHash: settlementTxHash,
        economicRole: "service_fee",
        economicProtocol: "tron_gasfree"
      })
    ]);
    expect(getTransactionCalls.filter((txHash) => txHash === settlementTxHash)).toHaveLength(1);
    expect(getTransactionCalls.filter((txHash) => txHash === fundingTxHash)).toHaveLength(1);
  });

  it("bounds dense-graph economic enrichment while prioritizing exact GasFree candidates", async () => {
    const settlementTxHash = "tx-deep-gasfree-budget-settlement";
    const duplicateTxHash = "tx-deep-gasfree-budget-duplicate";
    const errorTxHash = "tx-deep-gasfree-budget-error";
    const budgetSkippedTxHash = "tx-deep-gasfree-budget-skipped";
    const contractDrivenSkippedTxHash = "tx-deep-gasfree-budget-contract-driven-skipped";
    const duplicateRecipients = [
      "TDuplicateBudgetRecipient111111111111111",
      "TDuplicateBudgetRecipient222222222222222"
    ];
    const errorAddress = "TErrorBudgetRecipient111111111111111111";
    const budgetSkippedAddress = "TSkippedBudgetRecipient111111111111111";
    const contractDrivenSkippedAddress = "TSkippedBudgetSender111111111111111111";
    const intermediates = Array.from(
      { length: 8 },
      (_, index) => index === 0 ? budgetSkippedAddress : `TNoiseBudgetIntermediate${index}111111111111111`
    );
    const sourceEdges = [
      ...intermediates.map((address, index) => transfer({
        id: index === 0 ? budgetSkippedTxHash : `tx-deep-gasfree-budget-noise-${index}`,
        from: gasFreeReceiver,
        to: address,
        amountRaw: `${10_000_000 + index}`,
        at: `2026-07-10T00:${String(index).padStart(2, "0")}:00.000Z`
      })),
      transfer({
        id: contractDrivenSkippedTxHash,
        from: contractDrivenSkippedAddress,
        to: gasFreeReceiver,
        amountRaw: "20000000",
        at: "2026-07-10T00:09:00.000Z"
      }),
      transfer({
        id: errorTxHash,
        from: gasFreeReceiver,
        to: errorAddress,
        amountRaw: "21000000",
        at: "2026-07-10T00:10:00.000Z",
        triggerInfo: { methodName: "permitTransfer" }
      }),
      transfer({
        id: duplicateTxHash,
        from: duplicateRecipients[0],
        to: gasFreeReceiver,
        amountRaw: "22000000",
        at: "2026-07-10T00:11:00.000Z"
      }),
      transfer({
        id: duplicateTxHash,
        from: gasFreeReceiver,
        to: duplicateRecipients[1],
        amountRaw: "23000000",
        at: "2026-07-10T00:11:00.000Z"
      }),
      transfer({
        id: settlementTxHash,
        from: gasFreeReceiver,
        to: gasFreeAccount,
        amountRaw: "700000000",
        at: "2026-07-10T00:12:00.000Z",
        triggerInfo: { methodName: "permitTransfer" }
      }),
      transfer({
        id: settlementTxHash,
        from: gasFreeReceiver,
        to: gasFreeTlnt,
        amountRaw: "300000000",
        at: "2026-07-10T00:12:00.000Z",
        triggerInfo: { methodName: "permitTransfer" }
      })
    ];
    const transfersByAddress = new Map<string, RawTronscanTrc20Transfer[]>([
      [gasFreeReceiver, sourceEdges],
      ...intermediates.map((address, addressIndex): [string, RawTronscanTrc20Transfer[]] => [
        address,
        Array.from({ length: 2 }, (_, edgeIndex) => transfer({
          id: `tx-deep-gasfree-budget-layer2-${addressIndex}-${edgeIndex}`,
          from: address,
          to: `TNoiseBudgetSink${addressIndex}${edgeIndex}11111111111111111`,
          amountRaw: `${30_000_000 + addressIndex * 10 + edgeIndex}`,
          at: `2026-07-10T01:${String(addressIndex * 2 + edgeIndex).padStart(2, "0")}:00.000Z`
        }))
      ])
    ]);
    const indexedSourceEdges = sourceEdges.map((edge, index) => indexed({
      id: edge.transaction_id,
      from: edge.from_address,
      to: edge.to_address,
      amountRaw: edge.quant,
      at: new Date(edge.block_ts).toISOString(),
      eventIndex: index
    }));
    const getTransactionCalls: string[] = [];

    const report = await runDeepAddressForensicCheck({
      tronClient: {
        listRelatedTrc20Transfers: async (address) => transfersByAddress.get(address) ?? []
      },
      listIndexedUsdtTransfersForAddress: async (address, options) => address === gasFreeReceiver
        ? indexedSourceEdges.slice(options.offset ?? 0, (options.offset ?? 0) + options.limit)
        : [],
      getLabelsForAddress: async (address) =>
        address === gasFreeTlnt || address === errorAddress || address === budgetSkippedAddress
          ? [label(address)]
          : [],
      getAddressMetadata: async () => null,
      getTransaction: async (txHash) => {
        getTransactionCalls.push(txHash);
        if (txHash === errorTxHash) throw new Error("transaction detail unavailable");
        return txHash === settlementTxHash
          ? gasFreeTransaction({
              accountAddress: gasFreeReceiver,
              receiverAddress: gasFreeAccount,
              principalAmountRaw: "700000000",
              feeAmountRaw: "300000000"
            })
          : null;
      }
    }, {
      sourceAddress: gasFreeReceiver,
      windowStart: new Date("2026-07-01T00:00:00.000Z"),
      windowEnd: new Date("2026-07-11T00:00:00.000Z"),
      maxDepth: 2,
      pageLimit: 50,
      maxPagesPerAddress: 1,
      maxExpandedIntermediates: 20,
      metadataFetchLimit: 0,
      contractProfileFetchLimit: 0,
      maxInboundSenders: 0,
      extendedSearchMode: "disabled",
      economicEdgeTransactionInfoFetchLimit: 3,
      allTimeSubjectIndexState: completeIndexState(
        gasFreeReceiver,
        indexedSourceEdges.length,
        new Set(indexedSourceEdges.flatMap((edge) => [edge.fromAddress, edge.toAddress])).size - 1
      ),
      allTimeMode: "strict",
      secondLayerMaxActiveWalletsPerJob: 0
    });

    expect(new Set(getTransactionCalls).size).toBeLessThanOrEqual(3);
    expect(getTransactionCalls.filter((txHash) => txHash === settlementTxHash)).toHaveLength(1);
    expect(getTransactionCalls.filter((txHash) => txHash === duplicateTxHash)).toHaveLength(1);
    expect(getTransactionCalls.filter((txHash) => txHash === errorTxHash)).toHaveLength(1);
    expect(getTransactionCalls).not.toContain(budgetSkippedTxHash);
    expect(getTransactionCalls).not.toContain(contractDrivenSkippedTxHash);
    expect(report.missingChecks).toEqual(expect.arrayContaining([
      expect.stringContaining("Economic edge transaction enrichment limited to 3")
    ]));

    expect(report.counterpartyRiskProfiles.some((profile) => profile.counterpartyAddress === gasFreeTlnt)).toBe(false);
    expect(report.directCounterpartyInteractionProfiles?.find(
      (profile) => profile.counterpartyAddress === gasFreeTlnt
    )?.transfers).toEqual([
      expect.objectContaining({
        txHash: settlementTxHash,
        economicRole: "service_fee",
        economicProtocol: "tron_gasfree"
      })
    ]);
    expect(report.boundaryExposureProfiles.flatMap((profile) => profile.flows).some(
      (flow) => flow.boundaryAddress === gasFreeTlnt
    )).toBe(false);

    for (const ordinaryAddress of [errorAddress, budgetSkippedAddress, contractDrivenSkippedAddress]) {
      const ordinaryInteraction = report.directCounterpartyInteractionProfiles?.find(
        (profile) => profile.counterpartyAddress === ordinaryAddress
      );
      expect(ordinaryInteraction).toBeDefined();
      expect(ordinaryInteraction?.transfers?.[0]?.economicRole).toBeUndefined();
    }
  });

  it("uses exact Base58 equality when prioritizing subject-adjacent economic candidates", async () => {
    const caseMutatedSubject = gasFreeReceiver.toLowerCase();
    const getTransactionCalls: string[] = [];

    await runDeepAddressForensicCheck({
      tronClient: {
        listRelatedTrc20Transfers: async (address) => address === gasFreeReceiver
          ? [
              transfer({
                id: "tx-base58-case-mutated",
                from: caseMutatedSubject,
                to: "TBase58CaseMutatedNoise111111111111111",
                amountRaw: "1000000",
                at: "2026-07-10T00:00:00.000Z"
              }),
              transfer({
                id: "tx-base58-exact-subject",
                from: gasFreeReceiver,
                to: "TBase58ExactSubjectNoise111111111111111",
                amountRaw: "2000000",
                at: "2026-07-10T00:01:00.000Z"
              })
            ]
          : []
      },
      getLabelsForAddress: async () => [],
      getAddressMetadata: async () => null,
      getTransaction: async (txHash) => {
        getTransactionCalls.push(txHash);
        return null;
      }
    }, {
      sourceAddress: gasFreeReceiver,
      windowStart: new Date("2026-07-01T00:00:00.000Z"),
      windowEnd: new Date("2026-07-11T00:00:00.000Z"),
      maxDepth: 1,
      pageLimit: 10,
      maxPagesPerAddress: 1,
      maxExpandedIntermediates: 0,
      metadataFetchLimit: 0,
      contractProfileFetchLimit: 0,
      maxInboundSenders: 0,
      extendedSearchMode: "disabled",
      economicEdgeTransactionInfoFetchLimit: 1
    });

    expect(getTransactionCalls).toEqual(["tx-base58-exact-subject"]);
  });

  it.each([
    ["zero", 0, 0, 2],
    ["negative", -1, 0, 2],
    ["NaN", Number.NaN, 250, 251]
  ])("keeps a %s transaction budget bounded", async (_label, limit, expectedCalls, edgeCount) => {
    const getTransactionCalls: string[] = [];
    const edges = Array.from({ length: edgeCount }, (_, index) => transfer({
      id: `tx-budget-normalization-${index}`,
      from: gasFreeReceiver,
      to: `TBudgetNormalization${index}11111111111111111`,
      amountRaw: `${1_000_000 + index}`,
      at: "2026-07-10T00:00:00.000Z"
    }));

    await runDeepAddressForensicCheck({
      tronClient: {
        listRelatedTrc20Transfers: async (address) => address === gasFreeReceiver ? edges : []
      },
      getLabelsForAddress: async () => [],
      getAddressMetadata: async () => null,
      getTransaction: async (txHash) => {
        getTransactionCalls.push(txHash);
        return null;
      }
    }, {
      sourceAddress: gasFreeReceiver,
      windowStart: new Date("2026-07-01T00:00:00.000Z"),
      windowEnd: new Date("2026-07-11T00:00:00.000Z"),
      maxDepth: 1,
      pageLimit: Math.max(edgeCount, 1),
      maxPagesPerAddress: 1,
      maxExpandedIntermediates: 0,
      metadataFetchLimit: 0,
      contractProfileFetchLimit: 0,
      maxInboundSenders: 0,
      counterpartyFastSnapshotLimit: 0,
      counterpartyFastSnapshotActiveLimit: 0,
      extendedSearchMode: "disabled",
      economicEdgeTransactionInfoFetchLimit: limit
    });

    expect(new Set(getTransactionCalls).size).toBe(expectedCalls);
  });

  it("keeps an unmatched direct TLnt movement visible and scored while stopping at the provider boundary", async () => {
    const txHash = "tx-deep-unmatched-tlnt";
    const transferCalls: string[] = [];
    const report = await runDeepAddressForensicCheck({
      tronClient: {
        listRelatedTrc20Transfers: async (address) => {
          transferCalls.push(address);
          return address === gasFreeReceiver
            ? [transfer({
                id: txHash,
                from: gasFreeReceiver,
                to: gasFreeTlnt,
                amountRaw: "100000000",
                at: "2026-07-10T00:05:00.000Z",
                triggerInfo: { methodName: "transfer" }
              })]
            : [];
        }
      },
      getLabelsForAddress: async (address) => address === gasFreeTlnt ? [darknetLabel(address)] : [],
      getAddressMetadata: async () => null,
      getTransaction: async (requestedTxHash) => requestedTxHash === txHash
        ? gasFreeTransaction({ accountAddress: gasFreeReceiver, receiverAddress: gasFreeAccount })
        : null
    }, {
      sourceAddress: gasFreeReceiver,
      windowStart: new Date("2026-07-01T00:00:00.000Z"),
      windowEnd: new Date("2026-07-11T00:00:00.000Z"),
      maxDepth: 2,
      pageLimit: 10,
      maxPagesPerAddress: 1,
      maxExpandedIntermediates: 1,
      metadataFetchLimit: 0,
      contractProfileFetchLimit: 0,
      maxInboundSenders: 0,
      extendedSearchMode: "disabled"
    });

    const transferRow = report.directCounterpartyInteractionProfiles
      ?.find((profile) => profile.counterpartyAddress === gasFreeTlnt)
      ?.transfers?.find((item) => item.txHash === txHash);
    expect(transferRow).toBeDefined();
    expect(transferRow?.economicRole).toBeUndefined();
    expect(transferRow?.economicProtocol).toBeUndefined();
    expect(transferCalls).not.toContain(gasFreeTlnt);
    expect(report.missingChecks).toEqual(expect.arrayContaining([
      expect.stringContaining(`Expansion stopped at service boundary ${gasFreeTlnt}`)
    ]));
    expect(report.counterpartyRiskProfiles).toEqual(expect.arrayContaining([
      expect.objectContaining({
        counterpartyAddress: gasFreeTlnt,
        label: "darknet_exchange",
        amountRaw: "100000000",
        score: 80
      })
    ]));
  });

  it("preserves multiple exact Verify20 approval-drain profiles in DeepCheck", async () => {
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
      getTransaction: async (txHash) => {
        const firstDrain = txHash === "tx-wrapper-drain";
        return {
          ownerAddress: operator,
          contractData: { contract_address: wrapperContract, function_selector: "Verify20(address,address,uint256)" },
          trigger_info: { methodName: "Verify20" },
          trc20TransferInfo: [{
            from_address: firstDrain ? victim : secondVictim,
            to_address: subject,
            quant: firstDrain ? "2576000000" : "1200000000",
            contract_address: TRON_USDT_CONTRACT_ADDRESS,
            tokenInfo: { tokenAbbr: "USDT", tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenType: "trc20" }
          }]
        };
      },
      listTrc20ApprovalChanges: async (input) => [
        approval({
          txHash: `approval-${input.ownerAddress}`,
          ownerAddress: input.ownerAddress,
          spenderAddress: input.spenderAddress,
          amountRaw: "5000000000",
          timestamp: new Date("2026-05-20T09:50:00.000Z")
        })
      ],
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

    expect(report.approvalDrainProvenanceProfiles).toHaveLength(2);
    expect(report.contractDrivenReceiverProfile?.exactApprovalDrainCount).toBe(2);
    expect(report.contractDrivenCampaignSummary?.exactApprovalDrainProfileCount).toBe(2);
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

  it("enriches all-time plain transfer edges into a Verify20 campaign when transaction-info shows wrappers", async () => {
    const sourceAddress = "TSubjectCampaign1111111111111111111";
    const wrapperContract = "TWrapperCampaign111111111111111111";
    const operator = "TOperatorCampaign11111111111111111";
    const victims = Array.from({ length: 6 }, (_, index) => `TVictimCampaign${String(index).padStart(2, "0")}111111111111`);
    const plainSenders = Array.from({ length: 2 }, (_, index) => `TPlainSender${String(index).padStart(2, "0")}11111111111111`);
    const indexedTransfers: IndexedTronUsdtTransfer[] = [
      ...victims.map((victimAddress, index) => indexed({
        id: `tx-campaign-wrapper-${index}`,
        from: victimAddress,
        to: sourceAddress,
        amountRaw: `${(index + 1) * 1_000_000}`,
        at: `2026-06-29T10:0${index}:00.000Z`,
        eventIndex: index
      })),
      ...plainSenders.map((senderAddress, index) => indexed({
        id: `tx-campaign-plain-${index}`,
        from: senderAddress,
        to: sourceAddress,
        amountRaw: `${(index + 10) * 1_000_000}`,
        at: `2026-06-29T11:0${index}:00.000Z`,
        eventIndex: 10 + index
      }))
    ];
    const getTransactionCalls: string[] = [];

    const report = await runDeepAddressForensicCheck({
      tronClient: { listRelatedTrc20Transfers: async () => [] },
      listIndexedUsdtTransfersForAddress: async (address, options) => {
        if (address !== sourceAddress) return [];
        return indexedTransfers.slice(options.offset ?? 0, (options.offset ?? 0) + options.limit);
      },
      getLabelsForAddress: async () => [],
      getAddressMetadata: async () => null,
      getContractIntelligenceProfile: async () => null,
      getTransaction: async (txHash) => {
        getTransactionCalls.push(txHash);
        if (txHash.startsWith("tx-campaign-plain-")) {
          const index = Number(txHash.replace("tx-campaign-plain-", ""));
          return {
            ownerAddress: plainSenders[index],
            contractData: {
              contract_address: TRON_USDT_CONTRACT_ADDRESS,
              function_selector: "transfer(address _to,uint256 _value)"
            },
            trigger_info: {
              contract_address: TRON_USDT_CONTRACT_ADDRESS,
              methodName: "transfer"
            },
            trc20TransferInfo: [{
              from_address: plainSenders[index],
              to_address: sourceAddress,
              quant: `${(index + 10) * 1_000_000}`,
              contract_address: TRON_USDT_CONTRACT_ADDRESS,
              tokenInfo: { tokenAbbr: "USDT", tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenType: "trc20" }
            }]
          };
        }
        const index = Number(txHash.replace("tx-campaign-wrapper-", ""));
        return {
          ownerAddress: operator,
          contractData: {
            contract_address: wrapperContract,
            function_selector: "Verify20(address token,address from,address to,uint256 amount)"
          },
          trigger_info: { methodName: "Verify20" },
          trc20TransferInfo: [{
            from_address: victims[index],
            to_address: sourceAddress,
            quant: `${(index + 1) * 1_000_000}`,
            contract_address: TRON_USDT_CONTRACT_ADDRESS,
            tokenInfo: { tokenAbbr: "USDT", tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenType: "trc20" }
          }]
        };
      },
      listTrc20ApprovalChanges: async () => [],
      getUsdtRestrictionStatus: async (address) => usdtRestriction(address)
    }, {
      sourceAddress,
      windowStart: new Date(0),
      windowEnd: new Date("2026-07-02T00:00:00.000Z"),
      pageLimit: 20,
      maxPagesPerAddress: 3,
      maxInboundSenders: 2,
      maxApprovalDrainCandidates: 5,
      allTimeSubjectIndexState: completeIndexState(sourceAddress, 8, 8),
      allTimeMode: "strict",
      secondLayerMaxActiveWalletsPerJob: 0
    });

    expect(new Set(getTransactionCalls)).toEqual(new Set(indexedTransfers.map((item) => item.txHash)));
    expect(report.contractDrivenCampaignSummary).toMatchObject({
      incomingTxTotal: 8,
      txInfoEnrichedIncomingTx: 8,
      campaignClassificationStatus: "complete",
      countsAreLowerBounds: false,
      plainUsdtTransferTxCount: 2,
      wrapperDrivenIncomingTxCount: 6,
      verify20WrapperTxCount: 6
    });
    expect(report.contractDrivenReceiverProfile).toMatchObject({
      totalIncomingTxCount: 8,
      contractDrivenIncomingTxCount: 6,
      plainUsdtTransferTxCount: 2,
      wrapperDrivenIncomingTxCount: 6,
      verify20WrapperTxCount: 6
    });
    expect(report.contractDrivenTransferProfiles).toHaveLength(6);
    expect(report.contractDrivenTransferProfiles?.every((profile) => profile.method === "Verify20")).toBe(true);
  });

  it("enriches the full TPdr-like modest incoming denominator instead of capping at approval candidates", async () => {
    const sourceAddress = "TSubjectCampaign116111111111111";
    const wrapperContract = "TWrapperCampaign11611111111111";
    const operator = "TOperatorCampaign1161111111111";
    const wrapperTxCount = 101;
    const plainTxCount = 15;
    const timestampFor = (index: number) =>
      new Date(Date.UTC(2026, 5, 29, 10, Math.floor(index / 60), index % 60)).toISOString();
    const victims = Array.from({ length: wrapperTxCount }, (_, index) =>
      `TVictimCampaign116${String(index).padStart(3, "0")}`
    );
    const plainSenders = Array.from({ length: plainTxCount }, (_, index) =>
      `TPlainCampaign116${String(index).padStart(3, "0")}`
    );
    const indexedTransfers: IndexedTronUsdtTransfer[] = [
      ...victims.map((victimAddress, index) => indexed({
        id: `tx-wrapper-116-${index}`,
        from: victimAddress,
        to: sourceAddress,
        amountRaw: "1000000",
        at: timestampFor(index),
        eventIndex: index
      })),
      ...plainSenders.map((senderAddress, index) => indexed({
        id: `tx-plain-116-${index}`,
        from: senderAddress,
        to: sourceAddress,
        amountRaw: "2000000",
        at: timestampFor(wrapperTxCount + index),
        eventIndex: wrapperTxCount + index
      }))
    ];
    const getTransactionCalls: string[] = [];

    const report = await runDeepAddressForensicCheck({
      tronClient: { listRelatedTrc20Transfers: async () => [] },
      listIndexedUsdtTransfersForAddress: async (address, options) => {
        if (address !== sourceAddress) return [];
        return indexedTransfers.slice(options.offset ?? 0, (options.offset ?? 0) + options.limit);
      },
      getLabelsForAddress: async () => [],
      getAddressMetadata: async () => null,
      getContractIntelligenceProfile: async () => null,
      getTransaction: async (txHash) => {
        getTransactionCalls.push(txHash);
        if (txHash.startsWith("tx-plain-116-")) {
          const index = Number(txHash.replace("tx-plain-116-", ""));
          return {
            ownerAddress: plainSenders[index],
            contractData: {
              contract_address: TRON_USDT_CONTRACT_ADDRESS,
              function_selector: "transfer(address _to,uint256 _value)"
            },
            trigger_info: {
              contract_address: TRON_USDT_CONTRACT_ADDRESS,
              methodName: "transfer"
            },
            trc20TransferInfo: [{
              from_address: plainSenders[index],
              to_address: sourceAddress,
              quant: "2000000",
              contract_address: TRON_USDT_CONTRACT_ADDRESS,
              tokenInfo: { tokenAbbr: "USDT", tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenType: "trc20" }
            }]
          };
        }
        const index = Number(txHash.replace("tx-wrapper-116-", ""));
        return {
          ownerAddress: operator,
          contractData: {
            contract_address: wrapperContract,
            function_selector: "Verify20(address token,address from,address to,uint256 amount)"
          },
          trigger_info: { methodName: "Verify20" },
          trc20TransferInfo: [{
            from_address: victims[index],
            to_address: sourceAddress,
            quant: "1000000",
            contract_address: TRON_USDT_CONTRACT_ADDRESS,
            tokenInfo: { tokenAbbr: "USDT", tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenType: "trc20" }
          }]
        };
      },
      listTrc20ApprovalChanges: async () => [],
      getUsdtRestrictionStatus: async (address) => usdtRestriction(address)
    }, {
      sourceAddress,
      windowStart: new Date(0),
      windowEnd: new Date("2026-07-02T00:00:00.000Z"),
      pageLimit: 150,
      maxPagesPerAddress: 2,
      maxInboundSenders: 2,
      maxApprovalDrainCandidates: 5,
      allTimeSubjectIndexState: completeIndexState(sourceAddress, indexedTransfers.length, indexedTransfers.length),
      allTimeMode: "strict",
      secondLayerMaxActiveWalletsPerJob: 0
    });

    expect(new Set(getTransactionCalls)).toEqual(new Set(indexedTransfers.map((item) => item.txHash)));
    expect(report.contractDrivenCampaignSummary).toMatchObject({
      incomingTxTotal: 116,
      txInfoEnrichedIncomingTx: 116,
      campaignClassificationStatus: "complete",
      countsAreLowerBounds: false,
      plainUsdtTransferTxCount: 15,
      wrapperDrivenIncomingTxCount: 101,
      verify20WrapperTxCount: 101
    });
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

  it("rejects unsound persisted first-hop nested DTOs and normalizes valid JSON label dates", () => {
    const address = "TPersistedFirstHop111111111111111111";
    const directTxHash = "a".repeat(64);
    const eventTxHash = "b".repeat(64);
    const validLabel = {
      address,
      label: "phishing",
      source: "service_admin",
      createdByTelegramId: "1",
      createdAt: "2026-05-01T00:00:00.000Z"
    };
    const validClassification = {
      category: "cex",
      identity: "Known Exchange",
      confidence: "high",
      evidence: ["verified provider metadata"],
      isBoundary: true
    };
    const validRestriction = {
      subjectAddress: address,
      tokenContract: TRON_USDT_CONTRACT_ADDRESS,
      tokenSymbol: "USDT",
      tokenStandard: "TRC20",
      decimals: 6,
      isBlacklisted: true,
      balanceRaw: "0",
      checkedAt: "2026-05-24T00:00:00.000Z",
      evidenceStrength: "exact_contract_state",
      blacklistEventTxHash: eventTxHash,
      blacklistEventTimestamp: "2026-05-10T00:00:00.000Z",
      blacklistEventBlock: 100,
      blacklistTimeline: {
        events: [{
          eventKind: "added",
          occurredAt: "2026-05-10T00:00:00.000Z",
          txHash: eventTxHash,
          tokenContract: TRON_USDT_CONTRACT_ADDRESS,
          blockNumber: 100,
          logIndex: 2,
          verification: "verified_contract_log"
        }],
        pagination: "complete",
        failureReason: null
      },
      methods: { blacklist: "isBlackListed(address)", balance: "balanceOf(address)" }
    };
    const validSnapshot = {
      address,
      labels: [validLabel],
      classification: validClassification,
      usdtRestriction: validRestriction,
      evidenceStatus: "live_checked",
      hasHardEvidence: true,
      reasons: ["label:phishing", "usdt_blacklist"]
    };
    const validFact = {
      counterpartyAddress: address,
      direction: "inbound",
      evidenceKind: "usdt_blacklist",
      evidenceAuthority: "official_contract",
      statusAtCheck: "active",
      temporalRelation: "active_at_transfer",
      effectiveAt: "2026-05-10T00:00:00.000Z",
      effectiveTxHash: eventTxHash,
      checkedAt: "2026-05-24T00:00:00.000Z",
      principalAmountRaw: "10000000000",
      principalTxCount: 1,
      directionalPrincipalShare: 1,
      shareSemantics: "exact",
      transferTxHashes: [directTxHash],
      beforeEffectiveAmountRaw: "0",
      beforeEffectiveTxCount: 0,
      activeAmountRaw: "10000000000",
      activeTxCount: 1,
      unknownTimingAmountRaw: "0",
      unknownTimingTxCount: 0,
      directTransferCoverage: "complete",
      timelineCoverage: "complete",
      timelineEvents: validRestriction.blacklistTimeline.events
    };
    const validLabelFact = {
      counterpartyAddress: address,
      direction: "inbound",
      labelCode: "phishing",
      evidenceAuthority: "exact_internal",
      recordedAt: "2026-05-01T00:00:00.000Z",
      effectiveAt: null,
      principalAmountRaw: "10000000000",
      principalTxCount: 1,
      directionalPrincipalShare: 1,
      shareSemantics: "exact",
      transferTxHashes: [directTxHash],
      linkedToSelectedProvenance: false
    };
    const validCoverage = {
      requiredForDecision: true,
      scope: "all_time",
      windowStart: null,
      windowEnd: null,
      directPrincipalTransferCoverage: "complete",
      materialCounterpartyCount: 1,
      checkedMaterialCounterpartyCount: 1,
      failedMaterialCounterpartyCount: 0,
      uncheckedMaterialCounterpartyCount: 0,
      blacklistCheckCoverage: "complete",
      incompleteReason: null,
      confirmedAdverseFactCount: 1,
      completeTimelineFactCount: 1,
      partialTimelineFactCount: 0
    };
    const validEnvelope = {
      firstHopBlacklistFacts: [validFact],
      firstHopLabelFacts: [validLabelFact],
      firstHopBlacklistCoverage: validCoverage,
      directHardEvidenceSnapshots: [validSnapshot]
    };
    const validNormalized = normalizePersistedDeepFirstHopEvidence(validEnvelope);
    expect(validNormalized).toEqual({
      ...validEnvelope,
      directHardEvidenceSnapshots: [{
        ...validSnapshot,
        labels: [{ ...validLabel, createdAt: new Date(validLabel.createdAt) }]
      }]
    });
    expect(normalizePersistedDeepFirstHopEvidence({})).toEqual({});

    const uint256Overflow = (1n << 256n).toString();
    const laterEvent = {
      ...validRestriction.blacklistTimeline.events[0],
      occurredAt: "2026-05-11T00:00:00.000Z",
      txHash: "c".repeat(64),
      blockNumber: 101
    };
    const maliciousEnvelopes = [
      { ...validEnvelope, firstHopBlacklistFacts: [validFact, { ...validFact, statusAtCheck: "pending" }] },
      { ...validEnvelope, firstHopLabelFacts: [validLabelFact, { ...validLabelFact, labelCode: "arbitrary_future_string" }] },
      { ...validEnvelope, firstHopLabelFacts: [{ ...validLabelFact, labelCode: "victim" }] },
      { ...validEnvelope, firstHopLabelFacts: [{ ...validLabelFact, evidenceAuthority: "derived" }] },
      { ...validEnvelope, firstHopLabelFacts: [{ ...validLabelFact, recordedAt: "2026-05-02T00:00:00.000Z" }] },
      { ...validEnvelope, firstHopBlacklistFacts: [{ ...validFact, checkedAt: "2026-05-24T00:00:00Z" }] },
      { ...validEnvelope, firstHopBlacklistFacts: [{
        ...validFact,
        principalAmountRaw: uint256Overflow,
        activeAmountRaw: uint256Overflow
      }] },
      { ...validEnvelope, firstHopBlacklistFacts: [{ ...validFact, transferTxHashes: ["tx-direct"] }] },
      { ...validEnvelope, firstHopBlacklistFacts: [{
        ...validFact,
        temporalRelation: "active_at_transfer",
        beforeEffectiveAmountRaw: "10000000000",
        beforeEffectiveTxCount: 1,
        activeAmountRaw: "0",
        activeTxCount: 0
      }] },
      { ...validEnvelope, firstHopBlacklistFacts: [{
        ...validFact,
        timelineEvents: [{ ...validFact.timelineEvents[0], tokenContract: "TWrongContract" }]
      }] },
      { ...validEnvelope, directHardEvidenceSnapshots: [{ ...validSnapshot, labels: [{}] }] },
      { ...validEnvelope, directHardEvidenceSnapshots: [{ ...validSnapshot, classification: {} }] },
      { ...validEnvelope, directHardEvidenceSnapshots: [{ ...validSnapshot, usdtRestriction: {
        ...validRestriction,
        blacklistTimeline: {
          ...validRestriction.blacklistTimeline,
          events: [{ ...validRestriction.blacklistTimeline.events[0], verification: "unverified" }]
        }
      } }] },
      { ...validEnvelope, firstHopBlacklistFacts: [{
        ...validFact,
        effectiveAt: laterEvent.occurredAt,
        effectiveTxHash: laterEvent.txHash,
        timelineEvents: [laterEvent, validFact.timelineEvents[0]]
      }], directHardEvidenceSnapshots: [{ ...validSnapshot, usdtRestriction: {
        ...validRestriction,
        blacklistEventTimestamp: laterEvent.occurredAt,
        blacklistEventTxHash: laterEvent.txHash,
        blacklistTimeline: {
          ...validRestriction.blacklistTimeline,
          events: [laterEvent, validRestriction.blacklistTimeline.events[0]]
        }
      } }] },
      { ...validEnvelope, firstHopBlacklistCoverage: { ...validCoverage, confirmedAdverseFactCount: 0 } },
      { ...validEnvelope, firstHopBlacklistCoverage: { ...validCoverage, failedMaterialCounterpartyCount: 1 } },
      { firstHopBlacklistFacts: [validFact] }
    ];
    for (const malicious of maliciousEnvelopes) {
      expect(normalizePersistedDeepFirstHopEvidence(malicious)).toEqual({
        firstHopBlacklistFacts: [],
        firstHopLabelFacts: [],
        firstHopBlacklistCoverage: {
          requiredForDecision: true,
          scope: "checked_window",
          windowStart: null,
          windowEnd: null,
          directPrincipalTransferCoverage: "partial",
          materialCounterpartyCount: 0,
          checkedMaterialCounterpartyCount: 0,
          failedMaterialCounterpartyCount: 0,
          uncheckedMaterialCounterpartyCount: 0,
          blacklistCheckCoverage: "provider_failed",
          incompleteReason: "persisted_first_hop_evidence_invalid",
          confirmedAdverseFactCount: 0,
          completeTimelineFactCount: 0,
          partialTimelineFactCount: 0
        },
        directHardEvidenceSnapshots: []
      });
    }
  });
});
