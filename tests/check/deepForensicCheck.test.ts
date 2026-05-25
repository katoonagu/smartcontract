import { describe, expect, it } from "vitest";
import { runDeepAddressForensicCheck } from "../../src/check/deepForensicCheck";
import { TRON_USDT_CONTRACT_ADDRESS, type RawTronscanTrc20Transfer } from "../../src/parser/transactionParser";
import type { AddressLabel, IndexedTronUsdtTransfer, StablecoinRestrictionProfile } from "../../src/types";
import type { TronscanApprovalChange } from "../../src/tron/tronClient";

const subject = "TSubject111111111111111111111111111111";
const transit = "TTransit111111111111111111111111111111";
const risky = "TRisky1111111111111111111111111111111";
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
});
