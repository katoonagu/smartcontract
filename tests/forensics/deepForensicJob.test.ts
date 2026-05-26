import { describe, expect, it, vi } from "vitest";
import type { DeepAddressForensicReport } from "../../src/check/deepForensicCheck";
import { runSingleDeepForensicJobCycle } from "../../src/forensics/deepForensicJob";
import { TRON_USDT_CONTRACT_ADDRESS, type RawTronscanTrc20Transfer } from "../../src/parser/transactionParser";
import type { AddressLabelAssertionInput, ForensicCheckJob } from "../../src/storage/repositories";
import type { AddressLabel, StablecoinRestrictionProfile } from "../../src/types";
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

describe("deep forensic job runner", () => {
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
      }
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
